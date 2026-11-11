#if os(iOS)
import SwiftUI
import UIKit

/// iPhone / iPad の外付け・Bluetooth キーボード (Mac 版のキー操作と同じ考え)。
/// どの入力欄にもフォーカスがないときだけ、キーを受け取る (入力欄にフォーカスがあるときは、ふつうの入力のまま)。
/// ソフトウェアキーボードは出さない (inputView を持たない)。
struct HardwareKeys: UIViewRepresentable {
    /// キーの上げ下げ。受け取った (処理した) ときは true。
    var handler: (UIKey, Bool) -> Bool

    func makeUIView(context: Context) -> KeyView { let v = KeyView(); v.handler = handler; return v }
    func updateUIView(_ v: KeyView, context: Context) { v.handler = handler }

    final class KeyView: UIView {
        var handler: ((UIKey, Bool) -> Bool)?
        private var down = Set<UIKeyboardHIDUsage>()   // 押している最中のキー (押しっぱなしの連続発火を防ぐ)
        private var timer: Timer?

        override var canBecomeFirstResponder: Bool { true }
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false; isHidden = false }
        required init?(coder: NSCoder) { fatalError() }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            timer?.invalidate(); timer = nil
            NotificationCenter.default.removeObserver(self)
            guard window != nil else { return }
            let nc = NotificationCenter.default
            for n in [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification, UIApplication.didBecomeActiveNotification] {
                nc.addObserver(self, selector: #selector(reclaim), name: n, object: nil)
            }
            // 入力欄が閉じたあと・シートが閉じたあとにも、取り戻す
            timer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { [weak self] _ in self?.reclaim() }
            reclaim()
        }

        @objc private func reclaim() {
            guard window != nil, !isFirstResponder else { return }
            if let cur = UIResponder.pochiFirstResponder, cur is UITextInput || cur is UITextField || cur is UITextView { return } // 入力中
            if window?.rootViewController?.presentedViewController != nil { return } // シート・ダイアログが出ているあいだは、触らない
            _ = becomeFirstResponder()
        }

        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            var rest = Set<UIPress>()
            for p in presses {
                guard let key = p.key else { rest.insert(p); continue }
                if down.contains(key.keyCode) { continue }           // リピートは、無視
                down.insert(key.keyCode)
                if handler?(key, true) != true { rest.insert(p) }
            }
            if !rest.isEmpty { super.pressesBegan(rest, with: event) }
        }
        override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            var rest = Set<UIPress>()
            for p in presses {
                guard let key = p.key else { rest.insert(p); continue }
                down.remove(key.keyCode)
                if handler?(key, false) != true { rest.insert(p) }
            }
            if !rest.isEmpty { super.pressesEnded(rest, with: event) }
        }
        override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            for p in presses { if let k = p.key { down.remove(k.keyCode); _ = handler?(k, false) } }
            super.pressesCancelled(presses, with: event)
        }
        deinit { timer?.invalidate(); NotificationCenter.default.removeObserver(self) }
    }
}

extension UIResponder {
    private static weak var _pochiCur: UIResponder?
    /// いま first responder の相手 (なければ nil)
    static var pochiFirstResponder: UIResponder? {
        _pochiCur = nil
        UIApplication.shared.sendAction(#selector(UIResponder.pochiCapture), to: nil, from: nil, for: nil)
        return _pochiCur
    }
    @objc fileprivate func pochiCapture() { UIResponder._pochiCur = self }
}
#endif
