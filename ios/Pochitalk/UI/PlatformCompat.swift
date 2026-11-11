import SwiftUI
#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
extension PlatformImage { static func make(_ cg: CGImage) -> PlatformImage { UIImage(cgImage: cg) } }
extension Image { init(platform: PlatformImage) { self.init(uiImage: platform) } }
let reduceMotionOn: Bool = UIAccessibility.isReduceMotionEnabled
#else
import AppKit
typealias PlatformImage = NSImage
extension PlatformImage { static func make(_ cg: CGImage) -> PlatformImage { NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height)) } }
extension Image { init(platform: PlatformImage) { self.init(nsImage: platform) } }
let reduceMotionOn: Bool = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
#endif

extension View {
    /// iOS だけの見た目の指定 (Mac では何もしない)
    @ViewBuilder func inlineNavTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
    @ViewBuilder func noAutoCap() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }
}

#if os(iOS)
let openSettingsLabel = "設定アプリを開く"
func openSystemSettings() { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
#else
let openSettingsLabel = "システム設定を開く"
func openSystemSettings() { if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") { NSWorkspace.shared.open(u) } }
#endif

extension Notification.Name { static let pochiMenu = Notification.Name("pochitalk.menu") }

struct MacContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

extension Notification.Name { static let pochiDial = Notification.Name("pochitalk.dial") }
