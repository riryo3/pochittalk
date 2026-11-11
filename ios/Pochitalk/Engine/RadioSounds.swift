import AVFoundation
import Foundation

/// Web 版 (Web Audio API) の効果音を PCM で合成する (Android 版 RadioSounds.kt の移植)。
///  start: 送信開始の「ピッ」 / end: 発話終了のザラついた「ガッ」 / busy: 話中ブザー / crosstalk: 混線ノイズ
///  tune: 部屋を切り替えたときの「ザーッ」 / enter: 入室音「ピコーン」
/// 音色は Web 版に近づけているだけで、耳で聞いての微調整は実機で行う前提。
final class RadioSounds {
    unowned let device: PochiAudioDevice
    /// 効果音の音量 (0.0〜1.5)。0 で消える。マイクの送信音量には影響しない。
    var volume: Float = 1
    private var cache: [String: [Int16]] = [:]
    private var cacheRate: Double = 0

    init(device: PochiAudioDevice) { self.device = device }

    func playStart() { play("start", cached: true) { synthStart($0) } }
    func playEnd() { play("end", cached: false) { synthEnd($0) } }
    func playBusy() { play("busy", cached: true) { synthBusy($0) } }
    func playCrosstalk() { play("crosstalk", cached: false) { synthCrosstalk($0) } }
    func playTune() { play("tune", cached: false) { synthTune($0) } }
    func playNewRoom() { play("newroom", cached: true) { synthNewRoom($0) } }
    func playEnter() { play("enter", cached: true) { synthEnter($0) } }

    /// 音量の試し聴き (発話終了のザラついた「ガッ」)。部屋にいるときは、通話と同じ経路で鳴らす (実際の聞こえ方)。部屋の外では、音声ユニットが止まっているので、単独で鳴らす。
    private var previewPlayer: AVAudioPlayer?
    func playPreview() {
        let gain = volume
        if gain <= 0 || device.speakerMuted { return }
        if device.isUnitRunning { playEnd(); return }
        let rate = 48000.0
        let pcm = synthEnd(rate).map { Int16(max(-32767, min(32767, $0 * 32767 * gain))) }
        var d = Data()
        func put<T: FixedWidthInteger>(_ v: T) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        let bytes = pcm.count * 2
        d.append(contentsOf: Array("RIFF".utf8)); put(UInt32(36 + bytes)); d.append(contentsOf: Array("WAVEfmt ".utf8))
        put(UInt32(16)); put(UInt16(1)); put(UInt16(1)); put(UInt32(rate)); put(UInt32(rate) * 2); put(UInt16(2)); put(UInt16(16))
        d.append(contentsOf: Array("data".utf8)); put(UInt32(bytes))
        pcm.forEach { put($0) }
        previewPlayer?.stop()
        previewPlayer = try? AVAudioPlayer(data: d)
        previewPlayer?.play()
    }

    private func play(_ name: String, cached: Bool, _ synth: (Double) -> [Float]) {
        let gain = volume
        if gain <= 0 || device.speakerMuted { return }
        let rate = device.currentSampleRate
        if rate != cacheRate { cache.removeAll(); cacheRate = rate }
        let base: [Int16]
        if cached, let c = cache[name] { base = c } else {
            base = synth(rate).map { Int16(max(-1, min(1, $0)) * 32767) }
            if cached { cache[name] = base }
        }
        device.playEffect(gain == 1 ? base : base.map { Int16(max(-32767, min(32767, Float($0) * gain))) })
    }

    // ---------------------------------------------------------------- 合成

    private struct LowPass {
        let rate: Double; var y: Float = 0
        mutating func process(_ x: Float, cutoff: Float) -> Float {
            let a = 1 - exp(-2 * Float.pi * cutoff / Float(rate))
            y += a * (x - y)
            return y
        }
    }

    private struct HighPass {
        let a: Float; var y: Float = 0; var prevX: Float = 0
        init(cutoff: Float, rate: Double) {
            let rc = 1 / (2 * Float.pi * cutoff), dt = 1 / Float(rate)
            a = rc / (rc + dt)
        }
        mutating func process(_ x: Float) -> Float {
            y = a * (y + x - prevX)
            prevX = x
            return y
        }
    }

    private func synthStart(_ rate: Double) -> [Float] {
        let n = Int(rate * 0.08)
        var f = [Float](repeating: 0, count: n)
        var phase = 0.0
        for i in 0..<n {
            let t = Double(i) / rate
            let freq = t < 0.04 ? 880.0 : 1320.0
            phase += 2 * .pi * freq / rate
            let env = 0.12 * pow(0.001 / 0.12, t / 0.08)
            f[i] = Float(sin(phase) * env)
        }
        return f
    }

    /// 発話終了: ザラザラに歪んだノイズを細かく途切れさせた「ガッ」 (長さ0.16秒)。
    private func synthEnd(_ rate: Double) -> [Float] {
        let n = Int(rate * 0.16)
        var hp = HighPass(cutoff: 350, rate: rate)
        var lp = LowPass(rate: rate)
        var f = [Float](repeating: 0, count: n)
        var held: Float = 0
        for i in 0..<n {
            let t = Double(i) / rate
            if i % 5 == 0 { held = Float.random(in: -1...1) }
            let gate: Float = Int(t * 22) % 2 == 0 ? 1 : 0.15
            let decay: Float = t < 0.09 ? 1 : Float(max(0, 1 - (t - 0.09) / 0.07))
            let x = lp.process(hp.process(held * gate * decay), cutoff: 4200)
            f[i] = tanh(x * 5) * 0.07
        }
        return f
    }

    private func synthBusy(_ rate: Double) -> [Float] {
        let total = Int(rate * 0.21)
        var f = [Float](repeating: 0, count: total)
        for offset in [0.0, 0.12] {
            let start = Int(offset * rate), len = Int(0.08 * rate)
            for i in 0..<len where start + i < total {
                let t = Double(i) / rate
                f[start + i] = sin(2 * .pi * 330 * t) >= 0 ? 0.06 : -0.06
            }
        }
        return f
    }

    private func synthCrosstalk(_ rate: Double) -> [Float] {
        let dur = 0.7
        let n = Int(rate * dur)
        var hp = HighPass(cutoff: 400, rate: rate)
        var lp = LowPass(rate: rate)
        var f = [Float](repeating: 0, count: n)
        var held: Float = 0
        for i in 0..<n {
            let t = Double(i) / rate
            if i % 3 == 0 { held = Float.random(in: -1...1) }
            let wobble = Float(0.55 + 0.45 * sin(2 * .pi * 9 * t))
            let env = Float(max(0, 1 - t / dur))
            f[i] = lp.process(hp.process(held * wobble * env), cutoff: 3500) * 0.2 * 1.6
        }
        return f
    }

    /// 入室音「ピコーン」(短い高音のあとに、伸びる高音)。音量は Web 版の半分に下げてある。
    private func synthEnter(_ rate: Double) -> [Float] {
        let total = Int(rate * 0.72)
        var f = [Float](repeating: 0, count: total)
        func note(_ freq: Double, _ start: Double, _ dur: Double, _ vol: Double) {
            let s0 = Int(start * rate), len = Int(dur * rate)
            for i in 0..<len where s0 + i < total {
                let t = Double(i) / rate
                let env = t < 0.01 ? 0.001 * pow(vol / 0.001, t / 0.01) : vol * pow(0.001 / vol, (t - 0.01) / (dur - 0.01))
                f[s0 + i] += Float(sin(2 * .pi * freq * t) * env)
            }
        }
        note(1046.5, 0, 0.09, 0.07)
        note(1568.0, 0.08, 0.60, 0.07)
        note(3136.0, 0.08, 0.30, 0.015)
        return f
    }

    /// 新しい部屋ができた知らせ: 三角波の 5 音が上がっていく (約 0.9 秒。最後の音が余韻)。入室音とは別の音。
    private func synthNewRoom(_ rate: Double) -> [Float] {
        let total = Int(rate * 0.95)
        var f = [Float](repeating: 0, count: total)
        func tri(_ phase: Double) -> Double { 2 * abs(2 * (phase - floor(phase + 0.5))) - 1 }
        func note(_ freq: Double, _ start: Double, _ dur: Double, _ vol: Double) {
            let s0 = Int(start * rate), len = Int(dur * rate)
            for i in 0..<len where s0 + i < total {
                let t = Double(i) / rate
                let env = t < 0.01 ? 0.001 * pow(vol / 0.001, t / 0.01) : vol * pow(0.001 / vol, (t - 0.01) / (dur - 0.01))
                f[s0 + i] += Float(tri(freq * t) * env)
            }
        }
        let freqs = [659.3, 784.0, 1046.5, 1318.5, 2093.0]
        for (i, hz) in freqs.enumerated() {
            let start = Double(i) * 0.09
            note(hz, start, i == freqs.count - 1 ? 0.55 : 0.16, 0.07)
        }
        return f
    }

    private func synthTune(_ rate: Double) -> [Float] {
        let dur = 0.32
        let n = Int(rate * dur)
        var hp = HighPass(cutoff: 300, rate: rate)
        var lp = LowPass(rate: rate)
        var f = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let t = Double(i) / rate
            let cutoff = Float(500 * pow(3200.0 / 500.0, t / dur)) // 500Hz → 3200Hz
            let env = Float(0.12 * pow(0.001 / 0.12, t / dur))
            f[i] = lp.process(hp.process(Float.random(in: -1...1)), cutoff: cutoff) * env * 2.2
        }
        return f
    }
}
