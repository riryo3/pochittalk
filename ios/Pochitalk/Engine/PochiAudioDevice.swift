import AVFAudio
import AudioToolbox
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif
import WebRTC
import os

/// マイクとスピーカーを、アプリ自身が1つだけ持つ VoiceProcessingIO (エコー消し付き) の音声ユニットに集約する、
/// WebRTC 用のカスタム音声デバイス。ここが「ロック画面・バックグラウンドでも VOX が使える」ための中心。
///
///  - 部屋に入っている間 (`keepRunning = true`) は、WebRTC が録音/再生を要求していなくても、
///    音声セッションを手放さず、マイクを回し続ける。だから送信していない間も声の大きさを測れ (VOX 判定)、
///    押した瞬間にマイクの起動待ちが出ない。ロック中でも、iOS は「音声を扱い続けているアプリ」として生かしておく
///    (Info.plist の UIBackgroundModes = audio)。
///  - 送信するのは `transmitting == true` のあいだだけ。そうでないときは WebRTC へ音を渡さない (RTP も流れない)。
///  - 入力レベル (ゲイン) は、ここで拾った音に掛ける。レベルメーター/VOX は掛けたあとの大きさで見る (Web 版と同じ)。
///  - 効果音 (ピッ/ガッ など) は、再生側のバッファに混ぜて鳴らす。スピーカーのミュートはここで止める。
///  - 割り込み (電話の着信、Siri など) のあと、音声セッションとユニットを自動で立て直す。
final class PochiAudioDevice: NSObject, RTCAudioDevice {
    // ---- アプリ側から触る設定 (どのスレッドからでも読み書きできる単純な値)
    /// 部屋にいる間は true。音声セッションとマイクを保持する。
    private(set) var keepRunning = false
    /// 送信中だけ true。
    var transmitting = false
    /// モールス送信: true のあいだ、マイクの代わりに 700Hz の純音を送る。`morseKey` が押している状態。
    var morseMode = false
    var morseKey = false
    /// 送る純音の周波数 (モールスは 700Hz。FAX は、行の中で切り替える) と、大きさ
    var toneHz = 700.0
    var toneAmp: Float = 0.35
    private var mPhase = 0.0
    private var mGain: Float = 0
    /// 入力ゲイン (線形値)。
    var gain: Float = 1
    /// スピーカーのミュート (相手の声と効果音を止める)。
    var speakerMuted = false
    /// 録音が動いているか、最後に声の大きさを測った時刻と値 (ゲイン後の RMS)。
    private(set) var micLevel: Float = 0
    private(set) var lastCaptureAt: TimeInterval = 0
    /// 状態が変わったとき (割り込みで止まった/戻った) の通知。メインスレッドで呼ばれる。
    var onStateChange: ((_ running: Bool, _ note: String) -> Void)?
    /// 受信した音のトーンの測定 (モールス/FAX の復号用)。ミュートや効果音を混ぜる前の音を測る。
    let tones = ToneMeter()

    // ---- RTCAudioDevice
    private var delegate: RTCAudioDeviceDelegate?
    private var rtcPlaying = false
    private var rtcRecording = false
    private var playoutInit = false, recordInit = false
    private var sampleRate: Double = 48000
    private var ioDuration: TimeInterval = 0.02

    private var unit: AudioUnit?
    private var unitRunning = false
    private let audioQ = DispatchQueue(label: "app.pochitalk.audio")
    private let log = Logger(subsystem: "app.pochitalk", category: "audio")

    // ---- 取り込み用バッファ (リアルタイムスレッドでメモリを確保しないよう、先に作っておく)
    private let capCapacity = 8192
    private let capBuf: UnsafeMutablePointer<Int16>

    // ---- 効果音の混ぜ込み
    private let fxCapacity = 1 << 17
    private let fxBuf: UnsafeMutablePointer<Int16>
    private var fxRead = 0
    private var fxLock = os_unfair_lock_s()

    override init() {
        capBuf = .allocate(capacity: capCapacity)
        capBuf.initialize(repeating: 0, count: capCapacity)
        fxBuf = .allocate(capacity: fxCapacity)
        fxBuf.initialize(repeating: 0, count: fxCapacity)
        super.init()
        let nc = NotificationCenter.default
        #if os(iOS)
        nc.addObserver(self, selector: #selector(onInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(onRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(onMediaReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        nc.addObserver(self, selector: #selector(onForeground), name: UIApplication.didBecomeActiveNotification, object: nil)
        #else
        nc.addObserver(self, selector: #selector(onForeground), name: NSApplication.didBecomeActiveNotification, object: nil)
        #endif
    }

    var currentSampleRate: Double { sampleRate }

    // ================================================================ アプリからの操作

    /// 部屋に入った/出た。入っている間は音声セッションを保持して、マイクを回し続ける。
    func setKeepRunning(_ on: Bool) {
        audioQ.sync {
            keepRunning = on
            updateUnit()
        }
    }

    // ================================================================ RTCAudioDevice

    var deviceInputSampleRate: Double { sampleRate }
    var inputIOBufferDuration: TimeInterval { ioDuration }
    var inputNumberOfChannels: Int { 1 }
    #if os(iOS)
    var inputLatency: TimeInterval { AVAudioSession.sharedInstance().inputLatency }
    #else
    var inputLatency: TimeInterval { 0 }
    #endif
    var deviceOutputSampleRate: Double { sampleRate }
    var outputIOBufferDuration: TimeInterval { ioDuration }
    var outputNumberOfChannels: Int { 1 }
    #if os(iOS)
    var outputLatency: TimeInterval { AVAudioSession.sharedInstance().outputLatency }
    #else
    var outputLatency: TimeInterval { 0 }
    #endif

    private(set) var isInitialized = false
    func initialize(with delegate: RTCAudioDeviceDelegate) -> Bool {
        self.delegate = delegate
        isInitialized = true
        // 音声セッションは、ここ (アプリ) が全部管理する。WebRTC のサンプルレートの希望は聞かず、セッションの値を使う
        audioQ.sync { _ = configureSession(activate: false) }
        return true
    }
    func terminateDevice() -> Bool {
        isInitialized = false
        delegate = nil
        return true
    }

    var isPlayoutInitialized: Bool { playoutInit }
    func initializePlayout() -> Bool { playoutInit = true; return true }
    var isPlaying: Bool { rtcPlaying }
    func startPlayout() -> Bool { audioQ.sync { rtcPlaying = true; updateUnit(); return unitRunning || !keepRunning } }
    func stopPlayout() -> Bool { audioQ.sync { rtcPlaying = false; updateUnit(); return true } }

    var isRecordingInitialized: Bool { recordInit }
    func initializeRecording() -> Bool { recordInit = true; return true }
    var isRecording: Bool { rtcRecording }
    func startRecording() -> Bool { audioQ.sync { rtcRecording = true; updateUnit(); return unitRunning || !keepRunning } }
    func stopRecording() -> Bool { audioQ.sync { rtcRecording = false; updateUnit(); return true } }

    // ================================================================ 音声セッション

    /// カテゴリを通話向けにして、必要なら有効にする。audioQ 上で呼ぶ。
    @discardableResult
    private func configureSession(activate: Bool) -> Bool {
        #if os(macOS)
        sampleRate = 48000; ioDuration = 0.02 // Mac には音声セッションがない。標準の入出力を使う
        return true
        #else
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try s.setPreferredSampleRate(48000)
            try s.setPreferredIOBufferDuration(0.02)
            if activate { try s.setActive(true) }
            if s.sampleRate > 0 { sampleRate = s.sampleRate }
            ioDuration = s.ioBufferDuration > 0 ? s.ioBufferDuration : 0.02
            return true
        } catch {
            log.error("audio session setup failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
        #endif
    }

    private func deactivateSession() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    // ================================================================ ユニットの起動/停止

    private var shouldRun: Bool { keepRunning || rtcPlaying || rtcRecording }

    /// 必要かどうかに合わせて、音声ユニットを動かす/止める。audioQ 上で呼ぶ。
    private func updateUnit() {
        if shouldRun {
            if !unitRunning { startUnit() }
        } else if unitRunning || unit != nil {
            stopUnit()
            if !keepRunning { deactivateSession() }
        }
    }

    private var retryCount = 0

    private func startUnit() {
        guard configureSession(activate: true) else { scheduleRetry(); return }
        let oldRate = unit == nil ? sampleRate : -1
        _ = oldRate
        guard buildUnit() else { scheduleRetry(); return }
        var status = AudioOutputUnitStart(unit!)
        if status != noErr {
            log.error("AudioOutputUnitStart failed: \(status)")
            disposeUnit()
            scheduleRetry()
            return
        }
        status = noErr
        unitRunning = true
        retryCount = 0
        log.debug("audio unit started: rate=\(self.sampleRate)")
        notifyParamsChanged()
        DispatchQueue.main.async { self.onStateChange?(true, "started") }
    }

    private func stopUnit() {
        if let u = unit { AudioOutputUnitStop(u) }
        disposeUnit()
        let was = unitRunning
        unitRunning = false
        if was { DispatchQueue.main.async { self.onStateChange?(false, "stopped") } }
    }

    private func disposeUnit() {
        if let u = unit {
            AudioUnitUninitialize(u)
            AudioComponentInstanceDispose(u)
        }
        unit = nil
    }

    /// 起動に失敗した (他のアプリが音声を使っている等)。1秒ごとに最大30回やり直す。
    private func scheduleRetry() {
        guard shouldRun, retryCount < 30 else { return }
        retryCount += 1
        audioQ.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self, self.shouldRun, !self.unitRunning else { return }
            self.startUnit()
        }
    }

    private func notifyParamsChanged() {
        guard let d = delegate else { return }
        d.dispatchAsync {
            d.notifyAudioInputParametersChange()
            d.notifyAudioOutputParametersChange()
        }
    }

    private func buildUnit() -> Bool {
        var desc = AudioComponentDescription(
            componentType: kAudioUnitType_Output, componentSubType: kAudioUnitSubType_VoiceProcessingIO,
            componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
        guard let comp = AudioComponentFindNext(nil, &desc) else { return false }
        var u: AudioUnit?
        guard AudioComponentInstanceNew(comp, &u) == noErr, let au = u else { return false }

        var one: UInt32 = 1
        var ok = AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &one, 4) == noErr
        ok = ok && AudioUnitSetProperty(au, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &one, 4) == noErr
        var fmt = AudioStreamBasicDescription(
            mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
        let fsz = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        ok = ok && AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &fmt, fsz) == noErr
        ok = ok && AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &fmt, fsz) == noErr

        let me = Unmanaged.passUnretained(self).toOpaque()
        var inCb = AURenderCallbackStruct(inputProc: { ref, flags, ts, bus, frames, _ in
            Unmanaged<PochiAudioDevice>.fromOpaque(ref).takeUnretainedValue().handleInput(flags, ts, bus, frames)
        }, inputProcRefCon: me)
        ok = ok && AudioUnitSetProperty(au, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &inCb,
                                        UInt32(MemoryLayout<AURenderCallbackStruct>.size)) == noErr
        var outCb = AURenderCallbackStruct(inputProc: { ref, flags, ts, bus, frames, data in
            Unmanaged<PochiAudioDevice>.fromOpaque(ref).takeUnretainedValue().handleRender(flags, ts, bus, frames, data)
        }, inputProcRefCon: me)
        ok = ok && AudioUnitSetProperty(au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &outCb,
                                        UInt32(MemoryLayout<AURenderCallbackStruct>.size)) == noErr
        // 声の処理は端末の標準 (エコー消し・ノイズ抑制・自動音量) を使う
        var agc: UInt32 = 1
        _ = AudioUnitSetProperty(au, kAUVoiceIOProperty_VoiceProcessingEnableAGC, kAudioUnitScope_Global, 0, &agc, 4)
        guard ok, AudioUnitInitialize(au) == noErr else {
            AudioComponentInstanceDispose(au)
            return false
        }
        unit = au
        return true
    }

    // ================================================================ リアルタイムの処理 (音声スレッド)

    private func handleInput(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
                             _ ts: UnsafePointer<AudioTimeStamp>, _ bus: UInt32, _ frames: UInt32) -> OSStatus {
        guard let u = unit, Int(frames) <= capCapacity else { return noErr }
        var abl = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: frames * 2, mData: UnsafeMutableRawPointer(capBuf)))
        let st = AudioUnitRender(u, flags, ts, 1, frames, &abl)
        if st != noErr { return st }
        // ゲインを掛けて、大きさ (RMS) を測る。メーター/VOX はゲイン後の値で見る
        let g = gain
        var sum: Float = 0
        let n = Int(frames)
        for i in 0..<n {
            let v = Float(capBuf[i]) * g
            sum += v * v
            capBuf[i] = Int16(max(-32768, min(32767, v)))
        }
        if n > 0 {
            let rms = (sum / Float(n)).squareRoot() / 32768
            // 立ち上がりは即座に、下がりはゆっくり (Android 版 MicMonitor と同じ平滑化)
            micLevel = rms > micLevel ? rms : micLevel * 0.85 + rms * 0.15
            lastCaptureAt = ProcessInfo.processInfo.systemUptime
        }
        if morseMode {
            // マイクの音を、モールスの純音に置き換える (立ち上がり・立ち下がりは 4ms ほどなめらかに: クリック音を避ける)
            let rate = sampleRate
            let step = 2 * Double.pi * toneHz / rate
            let target: Float = morseKey ? toneAmp : 0
            let a = Float(1 - exp(-1 / (0.004 * rate)))
            for i in 0..<n {
                mGain += (target - mGain) * a
                capBuf[i] = Int16(sin(mPhase) * Double(mGain) * 32767)
                mPhase += step
                if mPhase > 2 * Double.pi { mPhase -= 2 * Double.pi }
            }
        }
        if rtcRecording, transmitting, let d = delegate {
            return withUnsafePointer(to: &abl) { p in
                d.deliverRecordedData(flags, ts, Int(bus), frames, p, nil, nil)
            }
        }
        return noErr
    }

    private func handleRender(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
                              _ ts: UnsafePointer<AudioTimeStamp>, _ bus: UInt32, _ frames: UInt32,
                              _ data: UnsafeMutablePointer<AudioBufferList>?) -> OSStatus {
        guard let data else { return noErr }
        let list = UnsafeMutableAudioBufferListPointer(data)
        var gotData = false
        if rtcPlaying, let d = delegate {
            gotData = d.getPlayoutData(flags, ts, Int(bus), frames, data) == noErr
        }
        for b in list {
            guard let m = b.mData else { continue }
            let p = m.assumingMemoryBound(to: Int16.self)
            let n = Int(b.mDataByteSize) / 2
            if !gotData { p.update(repeating: 0, count: n) }
            if b.mNumberChannels == 1 { tones.feed(p, n, rate: sampleRate) }
            if speakerMuted { p.update(repeating: 0, count: n) }
            if b.mNumberChannels == 1 { mixSidetone(p, n) }
            mixEffects(p, n)
        }
        return noErr
    }

    /// 送信中のモールス / FAX の音を、自分のスピーカーでも小さく鳴らす (モニター音)。キーの上げ下げは、なめらかに入り切りする。
    private var sidePhase = 0.0
    private var sideGain: Float = 0
    private func mixSidetone(_ out: UnsafeMutablePointer<Int16>, _ n: Int) {
        let on = morseMode && morseKey && !speakerMuted
        if !on && sideGain < 0.001 { sideGain = 0; return }
        let target: Float = on ? 1 : 0
        let step = 2 * Double.pi * toneHz / max(8000, sampleRate)
        let amp: Float = 0.12 * 32767
        for i in 0..<n {
            sideGain += (target - sideGain) * 0.02
            let s = Float(sin(sidePhase)) * sideGain * amp
            sidePhase += step; if sidePhase > 2 * Double.pi { sidePhase -= 2 * Double.pi }
            out[i] = Int16(max(-32768, min(32767, Int32(out[i]) + Int32(s))))
        }
    }

    private func mixEffects(_ out: UnsafeMutablePointer<Int16>, _ n: Int) {
        os_unfair_lock_lock(&fxLock)
        for i in 0..<n {
            let idx = (fxRead + i) & (fxCapacity - 1)
            let fx = fxBuf[idx]
            if fx != 0 {
                if !speakerMuted { out[i] = Int16(max(-32768, min(32767, Int32(out[i]) + Int32(fx)))) }
                fxBuf[idx] = 0
            }
        }
        fxRead = (fxRead + n) & (fxCapacity - 1)
        os_unfair_lock_unlock(&fxLock)
    }

    /// 音声ユニットが動いているか (部屋にいる間は true)
    var isUnitRunning: Bool { unitRunning }

    /// 効果音を鳴らす (再生側のバッファに足す)。ユニットが動いていないときは鳴らない。
    func playEffect(_ samples: [Int16]) {
        guard unitRunning, !speakerMuted else { return }
        os_unfair_lock_lock(&fxLock)
        let count = min(samples.count, fxCapacity / 2)
        for i in 0..<count {
            let idx = (fxRead + 2048 + i) & (fxCapacity - 1) // 少し先に置く (いま読んでいる所と重ならないように)
            fxBuf[idx] = Int16(max(-32768, min(32767, Int32(fxBuf[idx]) + Int32(samples[i]))))
        }
        os_unfair_lock_unlock(&fxLock)
    }

    // ================================================================ 割り込み・経路変更・復帰

    #if os(iOS)
    @objc private func onInterruption(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        audioQ.async { [self] in
            switch type {
            case .began:
                // 電話の着信など。システムが音声を止める。戻れるように「止まった」ことだけ覚える
                log.debug("interruption began")
                unitRunning = false
                if let u = unit { AudioOutputUnitStop(u) }
                DispatchQueue.main.async { self.onStateChange?(false, "interrupted") }
            case .ended:
                log.debug("interruption ended")
                resume()
            @unknown default: break
            }
        }
    }

    @objc private func onRouteChange(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        switch reason {
        case .newDeviceAvailable, .oldDeviceUnavailable, .override, .routeConfigurationChange:
            // サンプルレートなどが変わることがある。ユニットを作り直す
            audioQ.async { [self] in
                guard shouldRun, unitRunning else { return }
                let rate = AVAudioSession.sharedInstance().sampleRate
                if rate > 0, rate != sampleRate { restartUnit() }
            }
        default: break
        }
    }

    @objc private func onMediaReset(_ n: Notification) {
        audioQ.async { [self] in
            log.debug("media services were reset")
            unit = nil // 無効になっているので、解放せず捨てる
            unitRunning = false
            resume()
        }
    }

    #endif

    @objc private func onForeground() {
        audioQ.async { [self] in
            if shouldRun && !unitRunning { resume() }
        }
    }

    /// 止まっていたユニットを立て直す。audioQ 上で呼ぶ。
    private func resume() {
        guard shouldRun else { return }
        retryCount = 0
        if unit != nil { stopUnit() }
        startUnit()
    }

    private func restartUnit() {
        stopUnit()
        startUnit()
    }

    // 推測ではなく実測のために、いまの状態を文字列で返す (画面の診断表示用)
    var diagnostics: String {
        "running=\(unitRunning) keep=\(keepRunning) rtcRec=\(rtcRecording) rtcPlay=\(rtcPlaying) rate=\(Int(sampleRate))"
    }
}
