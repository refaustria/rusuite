import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 10000 });

// jsdom has no object URLs (blob URLs of images and attachments).
let objectUrls = 0;
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:test/${++objectUrls}`;
  URL.revokeObjectURL = () => undefined;
}
