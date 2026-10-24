import { addBookFromBytes, addBookFromUrl, goalRoute, listBookSummaries } from "@/src/server";

/** The library (fork #15): every book's summary. */
export async function GET() {
	return Response.json({ books: listBookSummaries() });
}

/** Add a book: multipart `file` (a PDF upload) or JSON { url }. The map
 *  is built in the background; the response is the new record. */
export async function POST(req: Request) {
	const type = req.headers.get("content-type") ?? "";
	if (type.includes("multipart/form-data")) {
		const form = await req.formData().catch(() => null);
		const file = form?.get("file");
		if (!(file instanceof File)) return Response.json({ error: "Attach a PDF as `file`" }, { status: 400 });
		const bytes = new Uint8Array(await file.arrayBuffer());
		return goalRoute(() => addBookFromBytes(file.name, bytes, "file"));
	}
	const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
	if (typeof body?.url !== "string") return Response.json({ error: "Send a PDF file or { url }" }, { status: 400 });
	const url = body.url;
	return goalRoute(() => addBookFromUrl(url));
}
