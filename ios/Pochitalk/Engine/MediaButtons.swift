import Foundation
import MediaPlayer

/// メディアボタン (イヤホンのボタン、スピーカーマイクの再生/停止ボタン、Mac のキーボードの再生キー) で、話す・止めるを切り替える。
/// メディアボタンは「押した」「離した」が分からず、再生/停止の指示が1回届くだけなので、押すたびに「話す」「止める」を切り替える。
/// 入室中だけ有効 (「いま再生中」の情報を持つ)。部屋の外・退室後は無効にして、他の音楽アプリに返す。
final class MediaButtons {
    private var tokens: [(MPRemoteCommand, Any)] = []
    private(set) var active = false
    var onToggle: (() -> Void)?

    func enable() {
        guard !active else { return }
        active = true
        DispatchQueue.main.async { [self] in
            let c = MPRemoteCommandCenter.shared()
            for cmd in [c.playCommand, c.pauseCommand, c.togglePlayPauseCommand] {
                cmd.isEnabled = true
                let t = cmd.addTarget { [weak self] _ in self?.onToggle?(); return .success }
                tokens.append((cmd, t))
            }
            // 音楽アプリ向けの、他のボタンは受けない
            for cmd in [c.nextTrackCommand, c.previousTrackCommand, c.seekForwardCommand, c.seekBackwardCommand, c.skipForwardCommand, c.skipBackwardCommand] { cmd.isEnabled = false }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = [
                MPMediaItemPropertyTitle: "ぽちっと通話",
                MPNowPlayingInfoPropertyPlaybackRate: 1.0,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
            ]
            MPNowPlayingInfoCenter.default().playbackState = .playing
        }
    }

    func disable() {
        guard active else { return }
        active = false
        DispatchQueue.main.async { [self] in
            for (cmd, t) in tokens { cmd.removeTarget(t) }
            tokens = []
            let c = MPRemoteCommandCenter.shared()
            for cmd in [c.playCommand, c.pauseCommand, c.togglePlayPauseCommand] { cmd.isEnabled = false }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
    }
}
