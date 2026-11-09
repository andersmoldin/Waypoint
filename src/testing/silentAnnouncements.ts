import { vi } from "vitest";

// azure-devops-ui's announce() writes to a live region on a timer that cannot
// be cancelled. A timer still waiting when a test file ends runs after Vitest
// has removed `document` and fails the run, whichever test started it. No unit
// test reads those announcements; the browser checks run the real one.
vi.mock("azure-devops-ui/Core/Util/Accessibility", () => ({ announce: () => undefined }));
