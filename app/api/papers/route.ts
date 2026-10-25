import { addPaperFromBytes, addPaperFromRef, calibration, goalRoute, listPaperSummaries } from "@/src/server";

/** The Papers shelf (fork #8): papers + the prediction calibration. */
export async function GET() {
	return Response.json({ papers: listPaperSummaries(), calibration: calibration() });
}

/** Add a paper: multipart `file` (a PDF) or JSON { ref } (arXiv id/link, PDF link, or article link). */
export async function POST(req: Request) {
	const type = req.headers.get("content-type") ?? "";
	if (type.includes("multipart/form-data")) {
		const form = await req.formData().catch(() => null);
		const file = form?.get("file");
		if (!(file instanceof File)) return Response.json({ error: "Attach a PDF as `file`" }, { status: 400 });
		const bytes = new Uint8Array(await file.arrayBuffer());
		return goalRoute(() => addPaperFromBytes(file.name, bytes));
	}
	const body = (await req.json().catch(() => null)) as { ref?: unknown } | null;
	if (typeof body?.ref !== "string") return Response.json({ error: "Send a PDF file or { ref }" }, { status: 400 });
	const ref = body.ref;
	return goalRoute(() => addPaperFromRef(ref));
}
