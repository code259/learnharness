// Packs build/dev/icon.icns from build/dev/icon-flat.svg (LearnHarness Dev).
// Rerun after changing the SVG: `node build/dev/make-icns.mjs`.
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, "icon-flat.svg"), "utf8");
const set = path.join(dir, "icon.iconset");
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const size of [16, 32, 128, 256, 512]) {
	for (const scale of [1, 2]) {
		const px = size * scale;
		const png = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render().asPng();
		writeFileSync(path.join(set, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`), png);
	}
}
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(dir, "icon.icns")]);
rmSync(set, { recursive: true });
console.log("wrote build/dev/icon.icns");
