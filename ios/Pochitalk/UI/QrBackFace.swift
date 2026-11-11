import CoreImage.CIFilterBuiltins
import SwiftUI

/// 無線機の裏面: 招待の QR コード、ルームハッシュ、URL。
struct QrBackFace: View {
    let roomKey: String

    var body: some View {
        let url = PochiEngine.shared.inviteUrl(for: roomKey) ?? PochiEngine.inviteBaseUrl + "?r=" + roomKey
        VStack(spacing: 14) {
            VStack(spacing: 6) {
                HStack {
                    Text("招待 QR").font(.system(size: 16, weight: .bold)).foregroundStyle(Color(hex: 0x93C5FD))
                    Spacer()
                }
                Rectangle().fill(Color(hex: 0x374151)).frame(height: 2)
            }
            Group {
                if let img = Self.qrImage(url) {
                    Image(platform: img).interpolation(.none).resizable().scaledToFit()
                } else {
                    Text("QRコードを作れませんでした。招待URLの送信をお使いください。").font(.system(size: 13)).foregroundStyle(Color(hex: 0x374151))
                }
            }
            .padding(14) // 白いシールの余白 (QR 自体の余白は 0)
            .frame(maxWidth: 250)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 14))
            .rotationEffect(.degrees(-1))
            .shadow(radius: 6)
            Text(formatKey(roomKey)).font(.system(size: 22, weight: .heavy, design: .monospaced)).tracking(2).foregroundStyle(Color(hex: 0x38BDF8))
            Text("このコードを読み取ると、同じ部屋に入れます。").font(.system(size: 13)).foregroundStyle(PC.muted).multilineTextAlignment(.center)
            Text(url).font(.system(size: 10)).foregroundStyle(PC.muted.opacity(0.75)).multilineTextAlignment(.center).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity)
    }

    /// 白地に黒の QR (周りの余白つき)。
    static func qrImage(_ text: String) -> PlatformImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage else { return nil }
        let scaled = out.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return PlatformImage.make(cg)
    }
}
