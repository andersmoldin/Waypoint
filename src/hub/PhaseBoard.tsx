import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import React, { useCallback, useRef, useState } from "react";
import type { Card, Column, Group, Truncation } from "../board/boardModel";
import type { Platform } from "../platform/platform";
import { DetailPanel } from "./DetailPanel";
import "./PhaseBoard.css";

/** What a card shows about the highlighted group: it is that group's, or some other's. */
type CardEmphasis = "own-group" | "other-group" | null;

export function PhaseBoard({
  columns,
  groups,
  truncation,
  platform,
}: {
  columns: Column[];
  groups: Group[];
  truncation: Truncation | null;
  platform: Platform;
}): React.JSX.Element {
  const [pointedAt, setPointedAt] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // The pointer wins for as long as it is on a group, so that it is not ignored while focus lies in the list.
  const highlightedGroup = pointedAt ?? focused;
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Stable, since a new function on every render would redraw every memoized card.
  const open = useCallback((card: Card, button: HTMLElement) => {
    opener.current = button;
    setOpenCard(card);
  }, []);
  // Safari does not focus a button that is clicked, so the panel cannot be left to find its way back.
  const close = () => {
    setOpenCard(null);
    opener.current?.focus();
  };

  return (
    <>
      {truncation && <TruncationBanner truncation={truncation} />}
      {groups.length > 0 && <GroupList groups={groups} onPointedAt={setPointedAt} onFocused={setFocused} />}
      {/* The columns can overflow, and tabIndex lets a keyboard user scroll them. */}
      <div className="waypoint-board" role="region" aria-label="Board" tabIndex={0}>
        {columns.length === 0 && <p>This tab has no phases.</p>}
        {columns.map((column, index) => (
          <React.Fragment key={index}>
            {column.dividerBefore && <PhaseDivider text={column.dividerBefore} />}
            <PhaseColumn column={column} headingId={`waypoint-column-${index}`} highlightedGroup={highlightedGroup} onOpen={open} />
          </React.Fragment>
        ))}
      </div>
      {openCard && <DetailPanel card={openCard} platform={platform} onDismiss={close} />}
    </>
  );
}

function GroupList({
  groups,
  onPointedAt,
  onFocused,
}: {
  groups: Group[];
  onPointedAt: (groupId: number | null) => void;
  onFocused: (groupId: number | null) => void;
}): React.JSX.Element {
  return (
    // The explicit role keeps the list a list in VoiceOver, which drops it along with the list style.
    <ul className="waypoint-groups" role="list" aria-label="Groups">
      {groups.map((group) => (
        // A stop for the keyboard, since focus does what the pointer does. Not a button: there is nothing to press.
        <li
          key={group.id}
          className="waypoint-group"
          tabIndex={0}
          onMouseEnter={() => onPointedAt(group.id)}
          onMouseLeave={() => onPointedAt(null)}
          onFocus={() => onFocused(group.id)}
          onBlur={() => onFocused(null)}
        >
          <span className="waypoint-group-dot" style={{ backgroundColor: group.color }} />
          {group.name}
        </li>
      ))}
    </ul>
  );
}

function TruncationBanner({ truncation: { shown, total } }: { truncation: Truncation }): React.JSX.Element {
  return (
    <MessageCard severity={MessageCardSeverity.Warning}>
      {`Showing ${formatCount(shown)} of ${formatCount(total)}. Narrow with filters or hide groups in settings.`}
    </MessageCard>
  );
}

/** The interface is in English whatever the browser's language, so the numbers are too. */
export function formatCount(count: number): string {
  return count.toLocaleString("en");
}

function PhaseDivider({ text }: { text: string }): React.JSX.Element {
  // A separator's content is not exposed to assistive technology, so the text has to be its name as well.
  return (
    <div className="waypoint-divider" role="separator" aria-orientation="vertical" aria-label={text}>
      <span className="waypoint-divider-text">{text}</span>
    </div>
  );
}

type CardOpener = (card: Card, button: HTMLElement) => void;

function PhaseColumn({
  column,
  headingId,
  highlightedGroup,
  onOpen,
}: {
  column: Column;
  headingId: string;
  highlightedGroup: number | null;
  onOpen: CardOpener;
}): React.JSX.Element {
  const shown = column.cards.length;
  return (
    <section className="waypoint-column">
      <h2 id={headingId} className="waypoint-column-heading">
        <span>{columnName(column)}</span>{" "}
        <span className="waypoint-column-count">
          {shown < column.total ? `${formatCount(shown)} of ${formatCount(column.total)}` : formatCount(shown)}
          <span className="screen-reader-only"> {column.total === 1 ? "object" : "objects"}</span>
        </span>
      </h2>
      {/* The explicit role keeps the list a list in VoiceOver, which drops it along with the list style. */}
      <ul className="waypoint-cards" role="list" aria-labelledby={headingId}>
        {column.cards.map((card) => (
          <PhaseCard key={card.id} card={card} emphasis={emphasisOf(card, highlightedGroup)} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function columnName(column: Column): string {
  switch (column.kind) {
    case "picklist":
      return column.phase;
    case "new":
      return `${column.phase} (new)`;
    case "unlisted":
      return `${column.phase} (not in the picklist)`;
    case "without-phase":
      return "No phase";
  }
}

function emphasisOf(card: Card, highlightedGroup: number | null): CardEmphasis {
  if (highlightedGroup === null) return null;
  return card.group?.id === highlightedGroup ? "own-group" : "other-group";
}

/**
 * The button is named by its own text, so the words the card shows stay in one piece for voice control,
 * and the phase and that the object does not wait follow them. The current situation can be long, so it
 * is outside the button as its description, to be heard or skipped. A click on it still opens the card.
 *
 * Memoized because a board holds up to 2,000 cards, and moving along the group list changes only some of them.
 */
const PhaseCard = React.memo(function PhaseCard({ card, emphasis, onOpen }: { card: Card; emphasis: CardEmphasis; onOpen: CardOpener }): React.JSX.Element {
  const { id, title, phase, group, currentSituation, waitingOn, marker } = card;
  const situationId = `waypoint-card-${id}-situation`;
  return (
    <li
      className={emphasis === "other-group" ? "waypoint-card waypoint-card-dimmed" : "waypoint-card"}
      style={group ? { borderLeftColor: group.color } : undefined}
      // The dimming of the others is never the only signal.
      aria-current={emphasis === "own-group" ? "true" : undefined}
    >
      <button
        type="button"
        className="waypoint-card-button"
        aria-describedby={currentSituation ? situationId : undefined}
        onClick={(event) => onOpen(card, event.currentTarget)}
      >
        <span className="waypoint-card-title">{title}</span>
        <span className="screen-reader-only">,</span>{" "}
        <span className="waypoint-card-group">{group ? group.name : "No group"}</span>
        {waitingOn && (
          <>
            <span className="screen-reader-only">,</span>{" "}
            <span className="waypoint-card-waiting">
              Waiting on: <span>{waitingOn}</span>
            </span>
          </>
        )}
        {marker && (
          <>
            <span className="screen-reader-only">,</span>{" "}
            <span className="waypoint-card-marker">{marker}</span>
          </>
        )}
        <span className="screen-reader-only">
          {phase === null ? ", no phase" : `, phase ${phase}`}
          {waitingOn === "" && ", not waiting"}
        </span>
      </button>
      {currentSituation && (
        <span id={situationId} className="waypoint-card-situation">
          {currentSituation}
        </span>
      )}
    </li>
  );
});
