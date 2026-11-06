import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import React, { useEffect, useState } from "react";
import { afterEach, expect } from "vitest";
import { Hub } from "../hub/Hub";
import type { FakePlatform } from "../platform/fakePlatform";
import { SettingsPanel } from "../settings/SettingsPanel";

afterEach(cleanup);

/**
 * Renders the whole hub against the given platform, the way a user meets it. When the hub opens its
 * settings panel, the panel appears beside it, as it does when the host opens the panel's own frame.
 */
export function renderHub(platform: FakePlatform): void {
  render(<HubWithItsPanel platform={platform} />);
}

function HubWithItsPanel({ platform }: { platform: FakePlatform }): React.JSX.Element {
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => platform.onSettingsPanelChange(setPanelOpen), [platform]);
  return (
    <>
      <Hub platform={platform} />
      {panelOpen && <SettingsPanel platform={platform} />}
    </>
  );
}

/**
 * Runs axe-core over everything the hub has rendered. A settings panel lives in a frame of its own
 * on the real page, so it is checked on its own rather than as part of the hub.
 */
export async function expectNoAccessibilityViolations(root: Element = document.body): Promise<void> {
  const { violations } = await axe.run(root, {
    // jsdom does no layout or painting, so contrast cannot be measured here.
    rules: {
      "color-contrast": { enabled: false },
      // The rig shows the hub and its panel on one page, where the real ones have a page each.
      "landmark-no-duplicate-main": { enabled: root === document.body },
    },
  });

  expect(violations.map(({ id, help, nodes }) => ({ id, help, targets: nodes.map((node) => node.target) }))).toEqual([]);
}
