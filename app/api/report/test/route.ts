import { NextResponse } from "next/server";

export async function GET() {
  try {
    const pdfMake  = (await import("pdfmake/build/pdfmake")).default;
    const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default;
    (pdfMake as any).vfs = (pdfFonts as any).vfs;

    const doc = pdfMake.createPdf({
      content: [{ text: "Test", fontSize: 12 }],
      defaultStyle: { font: "Roboto" },
    });

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      try {
        (doc as any).getBuffer((b: Uint8Array) => resolve(Buffer.from(b)));
      } catch (e) { reject(e); }
    });

    return NextResponse.json({ ok: true, size: buffer.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message, stack: err?.stack }, { status: 500 });
  }
}