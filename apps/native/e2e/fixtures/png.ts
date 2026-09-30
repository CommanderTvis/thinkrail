import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(data: Buffer): number {
	let c = 0xffffffff;
	for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

export function writeSolidPng(path: string, width: number, height: number): void {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.writeUInt8(8, 8);
	header.writeUInt8(2, 9);
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) row.set([0x33, 0x66, 0xaa], 1 + x * 3);
	const pixels = Buffer.concat(Array.from({ length: height }, () => row));
	writeFileSync(
		path,
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk("IHDR", header),
			chunk("IDAT", deflateSync(pixels)),
			chunk("IEND", Buffer.alloc(0)),
		]),
	);
}
