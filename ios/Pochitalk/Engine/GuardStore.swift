import Foundation

/// 自衛リスト: 嫌な言葉・ミュートする相手 (uid) を、この端末の中だけに保存する。外へは送らない。
struct GuardId: Equatable, Identifiable { var uid: String; var name: String; var id: String { uid } }

enum Guard {
    static let maxWords = 50, maxWordLen = 20, maxIds = 200
    static let reportBase = "https://docs.google.com/forms/d/e/1FAIpQLSe6jY8RmSERemjRLPO2YFQP1-sORD_6fgQKL4d6osGMuEmFTA/viewform?usp=pp_url"

    static func isUid(_ s: String) -> Bool {
        s.count == 16 && s.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }
    /// NFKC 正規化 + 小文字 + カタカナ→ひらがな
    static func norm(_ s: String) -> String {
        let t = s.precomposedStringWithCompatibilityMapping.lowercased()
        var out = String.UnicodeScalarView()
        for u in t.unicodeScalars {
            if u.value >= 0x30A1 && u.value <= 0x30F6, let h = Unicode.Scalar(u.value - 0x60) { out.append(h) } else { out.append(u) }
        }
        return String(out)
    }
    static func hit(_ text: String, words: [String]) -> Bool {
        if words.isEmpty || text.isEmpty { return false }
        let n = norm(text)
        return words.contains { !$0.isEmpty && n.contains(norm($0)) }
    }
    static func newUid() -> String {
        var b = [UInt8](repeating: 0, count: 8)
        _ = SecRandomCopyBytes(kSecRandomDefault, 8, &b)
        return b.map { String(format: "%02x", $0) }.joined()
    }
    /// 通報フォームの URL (通報者の情報は入れない)
    static func reportURL(name: String, uid: String?, room: String, time: String) -> URL? {
        func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? "" }
        let u = reportBase + "&entry.1506782741=" + enc(name) + "&entry.19877550=" + enc(uid ?? "（不明）")
            + "&entry.863421843=" + enc(room) + "&entry.129880049=" + enc(time)
        return URL(string: u)
    }
    static func nowText() -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.string(from: Date())
    }
}
