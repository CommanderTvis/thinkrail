import { describe, expect, it } from "bun:test";
import { carriesFileDrag, draggedFile, FILE_DRAG_TYPE, startFileDrag } from "./fileDrag";

function transfer(): DataTransfer {
	const data = new Map<string, string>();
	return {
		effectAllowed: "uninitialized",
		get types() {
			return [...data.keys()];
		},
		setData: (type: string, value: string) => void data.set(type, value),
		getData: (type: string) => data.get(type) ?? "",
	} as unknown as DataTransfer;
}

describe("fileDrag", () => {
	it("round-trips a tree entry and offers its path as plain text", () => {
		const dt = transfer();
		startFileDrag(dt, { path: "src/a b.ts", kind: "file" });
		expect(carriesFileDrag(dt)).toBe(true);
		expect(dt.getData("text/plain")).toBe("src/a b.ts");
		expect(draggedFile(dt)).toEqual({ path: "src/a b.ts", kind: "file" });
	});

	it("reads nothing from a drag that is not ours, or one that is malformed", () => {
		const plain = transfer();
		plain.setData("text/plain", "src/a.ts");
		expect(carriesFileDrag(plain)).toBe(false);
		expect(draggedFile(plain)).toBeNull();

		const broken = transfer();
		broken.setData(FILE_DRAG_TYPE, "{not json");
		expect(draggedFile(broken)).toBeNull();
		const wrongShape = transfer();
		wrongShape.setData(FILE_DRAG_TYPE, JSON.stringify({ path: 1, kind: "file" }));
		expect(draggedFile(wrongShape)).toBeNull();
	});
});
