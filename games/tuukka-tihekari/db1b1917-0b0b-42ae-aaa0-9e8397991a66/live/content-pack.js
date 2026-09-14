// VoxeLibre browser content loader
// SPDX-License-Identifier: GPL-3.0-or-later

(function () {
	"use strict";

	var PACK_URL = window.VOXELIBRE_CONTENT_URL || "voxelibre-content.zip";
	var TARGET_ROOT = "/games/voxelibre";
	var DEPENDENCY = "voxelibre-content-pack";
	var decoder = new TextDecoder("utf-8");

	function status(message, percent) {
		var launcher = Module["luantiLauncher"];
		if (launcher && typeof launcher["reportEngineStatus"] === "function")
			launcher["reportEngineStatus"](message, percent, "content");
	}

	function uint16(view, offset) {
		return view.getUint16(offset, true);
	}

	function uint32(view, offset) {
		return view.getUint32(offset, true);
	}

	function findEndRecord(view) {
		var start = Math.max(0, view.byteLength - 65557);
		for (var offset = view.byteLength - 22; offset >= start; offset--) {
			if (uint32(view, offset) === 0x06054b50)
				return offset;
		}
		throw new Error("VoxeLibre content pack has no ZIP directory");
	}

	function safePath(name) {
		var normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
		var parts = normalized.split("/").filter(Boolean);
		if (!parts.length || parts.some(function (part) { return part === "." || part === ".."; }))
			throw new Error("Unsafe path in VoxeLibre content pack: " + name);
		return parts.join("/");
	}

	function readEntries(bytes) {
		var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		var end = findEndRecord(view);
		var count = uint16(view, end + 10);
		var offset = uint32(view, end + 16);
		var entries = [];

		for (var index = 0; index < count; index++) {
			if (uint32(view, offset) !== 0x02014b50)
				throw new Error("Invalid VoxeLibre ZIP directory entry " + index);
			var flags = uint16(view, offset + 8);
			var method = uint16(view, offset + 10);
			var compressedSize = uint32(view, offset + 20);
			var uncompressedSize = uint32(view, offset + 24);
			var nameLength = uint16(view, offset + 28);
			var extraLength = uint16(view, offset + 30);
			var commentLength = uint16(view, offset + 32);
			var localOffset = uint32(view, offset + 42);
			var nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
			var name = safePath(decoder.decode(nameBytes));

			if (flags & 1)
				throw new Error("Encrypted entries are not supported: " + name);
			if (method !== 0 && method !== 8)
				throw new Error("Unsupported ZIP compression method " + method + ": " + name);
			entries.push({
				name: name,
				isDirectory: /\/$/.test(decoder.decode(nameBytes)),
				method: method,
				compressedSize: compressedSize,
				uncompressedSize: uncompressedSize,
				localOffset: localOffset
			});
			offset += 46 + nameLength + extraLength + commentLength;
		}
		return { view: view, entries: entries };
	}

	async function inflateRaw(data) {
		if (typeof DecompressionStream !== "function")
			throw new Error("This browser cannot unpack the VoxeLibre content pack");
		var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	async function extractEntry(bytes, archive, entry) {
		var view = archive.view;
		var offset = entry.localOffset;
		if (uint32(view, offset) !== 0x04034b50)
			throw new Error("Invalid local ZIP entry: " + entry.name);
		var nameLength = uint16(view, offset + 26);
		var extraLength = uint16(view, offset + 28);
		var start = offset + 30 + nameLength + extraLength;
		var compressed = bytes.subarray(start, start + entry.compressedSize);
		var output = entry.method === 0 ? compressed : await inflateRaw(compressed);
		if (output.byteLength !== entry.uncompressedSize)
			throw new Error("Size mismatch while unpacking " + entry.name);

		var destination = TARGET_ROOT + "/" + entry.name;
		if (entry.isDirectory) {
			FS.mkdirTree(destination);
			return;
		}
		FS.mkdirTree(destination.slice(0, destination.lastIndexOf("/")));
		FS.writeFile(destination, output, { canOwn: true });
	}

	async function downloadPack() {
		status("Connecting to VoxeLibre content…", 1);
		var response = await fetch(PACK_URL, { cache: "force-cache" });
		if (!response.ok)
			throw new Error("VoxeLibre download failed (HTTP " + response.status + ")");
		var total = Number(response.headers.get("content-length")) || 0;
		if (!response.body || !total)
			return new Uint8Array(await response.arrayBuffer());

		var reader = response.body.getReader();
		var chunks = [];
		var received = 0;
		while (true) {
			var result = await reader.read();
			if (result.done)
				break;
			chunks.push(result.value);
			received += result.value.byteLength;
			status("Downloading VoxeLibre… " + Math.round(received / total * 100) + "%", received / total * 72);
		}
		var bytes = new Uint8Array(received);
		var cursor = 0;
		chunks.forEach(function (chunk) {
			bytes.set(chunk, cursor);
			cursor += chunk.byteLength;
		});
		return bytes;
	}

	async function installPack() {
		var bytes = await downloadPack();
		status("Reading VoxeLibre content pack…", 74);
		var archive = readEntries(bytes);
		FS.mkdirTree(TARGET_ROOT);
		var next = 0;
		var completed = 0;
		// Limit simultaneous inflation buffers to avoid Chromium renderer OOMs.
		var workerCount = Math.min(2, navigator.hardwareConcurrency || 2);

		async function worker() {
			while (next < archive.entries.length) {
				var index = next++;
				await extractEntry(bytes, archive, archive.entries[index]);
				completed++;
				if (completed % 40 === 0 || completed === archive.entries.length)
					status("Installing VoxeLibre… " + completed + "/" + archive.entries.length,
						74 + completed / archive.entries.length * 25);
			}
		}

		await Promise.all(Array.from({ length: workerCount }, worker));
		status("VoxeLibre ready", 100);
	}

	var existing = Module["preRun"];
	if (!Array.isArray(existing))
		existing = existing ? [existing] : [];
	Module["preRun"] = existing;
	Module["preRun"].push(function () {
		addRunDependency(DEPENDENCY);
		installPack().then(function () {
			removeRunDependency(DEPENDENCY);
		}).catch(function (error) {
			console.error("VoxeLibre content failed", error);
			status("VoxeLibre failed: " + String(error.message || error), 100);
			Module["voxelibreContentError"] = String(error.message || error);
			removeRunDependency(DEPENDENCY);
		});
	});
})();
