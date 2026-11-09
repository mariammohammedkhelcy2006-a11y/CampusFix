const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function createElement() {
	return {
		attributes: {},
		listeners: {},
		hidden: false,
		value: "",
		textContent: "",
		addEventListener(type, callback) {
			this.listeners[type] = callback;
		},
		removeAttribute(name) {
			delete this.attributes[name];
			if (name === "src") this.src = "";
		},
	};
}

function createBrowser(fetchImplementation) {
	const elements = new Map();
	const objectUrls = [];
	const revokedUrls = [];
	const form = createElement();
	form.checkValidity = () => true;
	form.reportValidity = () => {};
	form.reset = () => {
		form.wasReset = true;
	};

	for (const selector of [
		"#issue-photo",
		"#photo-preview",
		"#photo-preview-image",
		"#remove-photo",
		"#photo-message",
		"#form-message",
		"#issue-title",
		"#description",
		"#category",
		"#location",
		"#reporter",
	]) {
		elements.set(selector, createElement());
	}
	elements.set("#issue-form", form);
	elements.get("#issue-title").value = "Broken light";
	elements.get("#description").value = "The light is out.";
	elements.get("#category").value = "Electricity";
	elements.get("#location").value = "Library";
	elements.get("#reporter").value = "Student";
	elements.get("#photo-preview").hidden = true;

	const formDataInstances = [];
	class TestFormData {
		constructor() {
			this.entries = [];
			formDataInstances.push(this);
		}

		append(...entry) {
			this.entries.push(entry);
		}
	}

	let readyCallback;
	const document = {
		addEventListener(type, callback) {
			if (type === "DOMContentLoaded") readyCallback = callback;
		},
		getElementById() {
			return null;
		},
		querySelector(selector) {
			return elements.get(selector) || null;
		},
		querySelectorAll() {
			return [];
		},
	};
	const sandbox = {
		document,
		fetch: fetchImplementation,
		FormData: TestFormData,
		sessionStorage: { getItem: () => null, removeItem: () => {} },
		URL: {
			createObjectURL: () => {
				const url = `blob:test-${objectUrls.length + 1}`;
				objectUrls.push(url);
				return url;
			},
			revokeObjectURL: (url) => revokedUrls.push(url),
		},
		window: { location: { pathname: "/" } },
	};

	vm.runInNewContext(
		`${script}\nglobalThis.testHooks = { validateSelectedPhoto, showSelectedPhoto, clearSelectedPhoto, uploadIssuePhoto };`,
		sandbox,
	);
	const ready = readyCallback();

	return { elements, formDataInstances, objectUrls, revokedUrls, sandbox, ready };
}

function selectPhoto(browser, file) {
	browser.elements.get("#issue-photo").listeners.change({
		target: { files: [file] },
	});
}

test("JPEG, PNG, and WEBP are accepted while unsupported and oversized files are rejected", async () => {
	const browser = createBrowser(async () => {
		throw new Error("No request expected");
	});
	await browser.ready;
	const validate = browser.sandbox.testHooks.validateSelectedPhoto;
	const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

	assert.match(html, /id="issue-photo"[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
	assert.match(html, /Maximum file size: 5 MB/);
	for (const type of ["image/jpeg", "image/png", "image/webp"]) {
		assert.equal(validate({ type, size: 1024 }), true);
	}
	assert.equal(validate({ type: "image/gif", size: 1024 }), false);
	assert.match(browser.elements.get("#photo-message").textContent, /JPEG, PNG, or WEBP/);
	assert.equal(validate({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 }), false);
	assert.match(browser.elements.get("#photo-message").textContent, /5 MB or smaller/);
});

test("selected photo preview can be removed and its object URL is released", async () => {
	const browser = createBrowser(async () => {
		throw new Error("No request expected");
	});
	await browser.ready;
	const file = { type: "image/png", size: 128 };
	selectPhoto(browser, file);

	assert.equal(browser.elements.get("#photo-preview").hidden, false);
	assert.equal(browser.elements.get("#photo-preview-image").src, "blob:test-1");

	browser.elements.get("#remove-photo").listeners.click();

	assert.equal(browser.elements.get("#issue-photo").value, "");
	assert.equal(browser.elements.get("#photo-preview").hidden, true);
	assert.deepEqual(browser.revokedUrls, ["blob:test-1"]);
});

test("photo upload sends the file field as browser-generated multipart data", async () => {
	const browser = createBrowser(async (url, options) => {
		assert.equal(url, "https://campusfix-ixxc.onrender.com/uploads/images");
		assert.equal(options.method, "POST");
		assert.equal(options.headers, undefined);
		return { ok: true, json: async () => ({ image_url: "https://images.test/photo.jpg" }) };
	});
	await browser.ready;
	const file = { type: "image/jpeg", size: 128, name: "photo.jpg" };

	const response = await browser.sandbox.testHooks.uploadIssuePhoto(file);

	assert.deepEqual(response, { image_url: "https://images.test/photo.jpg" });
	assert.deepEqual(browser.formDataInstances[0].entries, [["file", file]]);
});

test("successful upload attaches its URL to the submitted report", async () => {
	const calls = [];
	const browser = createBrowser(async (url, options) => {
		calls.push({ url, options });
		if (url.endsWith("/uploads/images")) {
			return { ok: true, json: async () => ({ image_url: "https://images.test/photo.jpg" }) };
		}
		return { ok: true, status: 201 };
	});
	await browser.ready;
	selectPhoto(browser, { type: "image/jpeg", size: 128, name: "photo.jpg" });

	await browser.elements.get("#issue-form").listeners.submit({
		preventDefault() {},
		currentTarget: browser.elements.get("#issue-form"),
	});

	const issueRequest = calls.find(({ url }) => url.endsWith("/issues"));
	assert.equal(issueRequest.options.method, "POST");
	assert.equal(JSON.parse(issueRequest.options.body).image_url, "https://images.test/photo.jpg");
	assert.match(browser.elements.get("#form-message").textContent, /submitted successfully/i);
});

test("failed optional photo upload does not block report submission", async () => {
	const calls = [];
	const browser = createBrowser(async (url, options) => {
		calls.push({ url, options });
		if (url.endsWith("/uploads/images")) return { ok: false, status: 502 };
		return { ok: true, status: 201 };
	});
	await browser.ready;
	selectPhoto(browser, { type: "image/jpeg", size: 128, name: "photo.jpg" });

	await browser.elements.get("#issue-form").listeners.submit({
		preventDefault() {},
		currentTarget: browser.elements.get("#issue-form"),
	});

	const issueRequest = calls.find(({ url }) => url.endsWith("/issues"));
	assert.ok(issueRequest, "report request should still be sent after photo upload failure");
	assert.equal(Object.hasOwn(JSON.parse(issueRequest.options.body), "image_url"), false);
	assert.equal(browser.elements.get("#issue-form").wasReset, true);
	assert.match(browser.elements.get("#form-message").textContent, /submitted successfully without the photo/i);
	assert.match(browser.elements.get("#photo-message").textContent, /couldn't upload/i);
});
