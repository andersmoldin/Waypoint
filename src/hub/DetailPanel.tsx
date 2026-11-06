import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { CustomPanel, PanelContent, PanelFooter, PanelHeader } from "azure-devops-ui/Panel";
import React, { useEffect, useRef, useState } from "react";
import type { Card } from "../board/boardModel";
import type { Platform } from "../platform/platform";
import "./DetailPanel.css";

const TITLE_ID = "waypoint-detail-panel-title";

/** The side panel a card opens: the object's title, its chosen fields, and the way to its work item. */
export function DetailPanel({ card, platform, onDismiss }: { card: Card; platform: Platform; onDismiss: () => void }): React.JSX.Element {
  const [failure, setFailure] = useState<string | null>(null);

  // Azure DevOps answers when the work item closes again, which may be after this panel has gone.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const openButton = useRef<Button>(null);

  const openWorkItem = () => {
    setFailure(null);
    platform
      .openWorkItem(card.id)
      .catch((error: Error) => {
        if (mounted.current) setFailure(error.message);
      })
      // The host's dialog took the focus and the browser cleared it here, so Tab and Escape would miss this modal panel.
      .finally(() => openButton.current?.focus());
  };

  return (
    <CustomPanel ariaLabelledBy={TITLE_ID} onDismiss={onDismiss}>
      {/* The library's buttons swallow Escape and drop the focus, so it has to be caught on its way to them. */}
      <div
        className="waypoint-detail-panel-frame"
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          event.preventDefault();
          onDismiss();
        }}
      >
        <PanelHeader titleProps={{ id: TITLE_ID, text: card.title }} onDismiss={onDismiss} />
        <PanelContent>
          <div className="waypoint-detail-panel">
            {failure && <MessageCard severity={MessageCardSeverity.Error}>Waypoint could not open the work item: {failure}</MessageCard>}
            <dl className="waypoint-details">
              {card.details.map(({ name, value }, index) => (
                <React.Fragment key={index}>
                  <dt>{name}</dt>
                  <dd>{value || <em>Not filled in</em>}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        </PanelContent>
        <PanelFooter>
          <ButtonGroup className="bolt-panel-footer-buttons flex-grow">
            <Button ref={openButton} text="Open work item" primary onClick={openWorkItem} />
          </ButtonGroup>
        </PanelFooter>
      </div>
    </CustomPanel>
  );
}
