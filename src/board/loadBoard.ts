import { MAX_WORK_ITEMS_PER_BATCH, type PicklistField, type Platform, type WorkItem, type WorkItemField } from "../platform/platform";
import {
  GUESSED_TYPES,
  NO_CARD_FIELDS,
  arrangeTabs,
  orderPhases,
  parseSettingsDocument,
  phasesInPicklistOrder,
  readCardFields,
  readProjectOptions,
  usablePhaseField,
  type CardFields,
  type FilterField,
  type PhaseTab,
  type Settings,
} from "../settings/settings";
import {
  PARENT_FIELD,
  TAGS_FIELD,
  TITLE_FIELD,
  TYPE_FIELD,
  groupsAmong,
  offeredFilterFields,
  parentIdOf,
  type BoardFilterField,
  type BoardSource,
  type Group,
} from "./boardModel";

/** Azure DevOps may delay or block a user who sends too much at once, and a read can hold up to 20,000 work items. */
const MAX_BATCHES_AT_ONCE = 6;

export interface LoadedBoard {
  /** What the hub guessed because nothing is saved yet, or null once settings are saved. */
  guess: Guess | null;
  /** What to build the board from. Null only when nothing is saved and the guess found no phase field to build one from. */
  source: BoardSource | null;
  /** Which saved filter fields the board does without today and why, to show the viewer. */
  filterFieldWarnings: string[];
  /** Fields the saved settings name for the cards that the object's type no longer has in a usable form, so the board does without them. */
  goneFields: string[];
}

export interface Guess {
  objectType: string;
  groupType: string;
  /** The display name of the guessed phase field, or null if the object type has no picklist field. */
  phaseFieldName: string | null;
}

/**
 * Fetches everything fresh from the platform for the board that saved settings describe or, until
 * there are any, for a guess. Rejects if any part cannot be fetched, and with an
 * {@link InvalidSettingsError} if the saved settings cannot be used.
 */
export async function loadBoard(platform: Platform): Promise<LoadedBoard> {
  const { id: projectId } = await platform.getProject();
  const stored = await platform.getSettingsDocument(projectId);
  const settings = stored && parseSettingsDocument(stored.content).settings;
  if (!settings) {
    const picklistFields = await platform.getPicklistFields(projectId, GUESSED_TYPES.objectType);
    const [guessedField] = picklistFields;
    return {
      guess: { ...GUESSED_TYPES, phaseFieldName: guessedField?.name ?? null },
      source: guessedField
        ? await fetchSource(platform, projectId, {
            ...GUESSED_TYPES,
            phaseField: guessedField.referenceName,
            tabs: arrangeTabs(undefined, phasesInPicklistOrder(guessedField.values)),
            hiddenGroups: [],
            filterFields: [],
            cardFields: NO_CARD_FIELDS,
          })
        : null,
      filterFieldWarnings: [],
      goneFields: [],
    };
  }

  const { objectType, groupType, phaseField, phaseOrder, hiddenGroups, tabs: savedTabs, filterFields: savedFilterFields } = settings;
  const { workItemTypes, picklistFields, fields } = await readProjectOptions(platform, projectId, objectType);
  const phases = orderPhases(phaseOrder, usablePhaseField(settings, workItemTypes, picklistFields).values);
  const { offered, warnings } = await readFilterFields(platform, projectId, savedFilterFields, picklistFields, fields);
  const cardFields = readCardFields(settings, fields);
  return {
    guess: null,
    source: await fetchSource(platform, projectId, { objectType, groupType, phaseField, hiddenGroups, tabs: arrangeTabs(savedTabs, phases), filterFields: offered, cardFields }),
    filterFieldWarnings: warnings,
    goneFields: cardFields.gone,
  };
}

/**
 * What the saved filter fields can offer today. A filter field that cannot be used costs itself and not
 * the board: a read that asks for a field that does not exist fails as a whole, and tags that cannot be
 * read say nothing about the objects, which someone may have every right to see.
 */
async function readFilterFields(
  platform: Platform,
  projectId: string,
  saved: FilterField[],
  picklistFields: PicklistField[],
  fields: WorkItemField[],
): Promise<{ offered: BoardFilterField[]; warnings: string[] }> {
  const namesOfTagFields = saved.filter(({ type }) => type === "tagPrefix").map(({ name }) => name);
  const { tags, tagsFailure } =
    namesOfTagFields.length === 0
      ? { tags: [], tagsFailure: null }
      : await platform.getProjectTags(projectId).then(
          (tags) => ({ tags, tagsFailure: null }),
          (error: Error) => ({ tags: [], tagsFailure: error.message }),
        );
  const { offered, gone } = offeredFilterFields(tagsFailure === null ? saved : saved.filter(({ type }) => type !== "tagPrefix"), { picklistFields, fields, tags });
  return {
    offered,
    warnings: [
      ...(gone.length > 0
        ? [`Waypoint left out ${filterCount(gone.length)}, because the fields they use are gone or can no longer be used that way. A Project Administrator can change them in Waypoint's settings.`]
        : []),
      ...(tagsFailure === null ? [] : [`Waypoint could not read the project's tags, so it left out ${filterCount(namesOfTagFields.length)}. ${tagsFailure}`]),
    ],
  };
}

/** Counted and not named: the names come from a document anyone can write, and this is said in Waypoint's own voice. */
function filterCount(count: number): string {
  return count === 1 ? "1 filter" : `${count} filters`;
}

/** What decides what is fetched for the board: saved settings or the guess, with the tabs as they stand today. */
type BoardChoices = Pick<Settings, "objectType" | "groupType" | "phaseField" | "hiddenGroups"> & { tabs: PhaseTab[]; filterFields: BoardFilterField[]; cardFields: CardFields };

async function fetchSource(
  platform: Platform,
  projectId: string,
  { objectType, groupType, phaseField, hiddenGroups, tabs, filterFields, cardFields }: BoardChoices,
): Promise<BoardSource> {
  const [ids, groupIds] = await Promise.all([
    platform.queryWorkItemIds(projectId, objectType),
    platform.queryWorkItemIds(projectId, groupType),
  ]);
  const fields = new Set([
    TITLE_FIELD,
    PARENT_FIELD,
    phaseField,
    ...filterFields.map((filterField) => (filterField.type === "tagPrefix" ? TAGS_FIELD : filterField.referenceName)),
    ...[...Object.values(cardFields.roles), ...cardFields.details].map(({ referenceName }) => referenceName),
  ]);
  const objects = await readInBatches(platform, projectId, ids, [...fields]);
  // A parent can lie outside what the query for groups finds, for example in another project.
  const parentIds = [...new Set([...groupIds, ...objects.flatMap((object) => parentIdOf(object) ?? [])])];
  const parents = await readInBatches(platform, projectId, parentIds, [TITLE_FIELD, TYPE_FIELD]);
  return { phaseField, tabs, hiddenGroups, groupType, filterFields, cardFields, objects, parents };
}

/**
 * The groups of a type that can be chosen, in name order: the project's, and those among `hidden` that
 * the query for the project's groups does not find, for example in another project. An id in `hidden`
 * that cannot be read or is of another type is left out.
 */
export async function readGroups(platform: Platform, projectId: string, groupType: string, hidden: number[]): Promise<Group[]> {
  const groupIds = await platform.queryWorkItemIds(projectId, groupType);
  const ids = [...new Set([...groupIds, ...hidden])];
  return groupsAmong(await readInBatches(platform, projectId, ids, [TITLE_FIELD, TYPE_FIELD]), groupType);
}

async function readInBatches(platform: Platform, projectId: string, ids: number[], fields: string[]): Promise<WorkItem[]> {
  const batches: number[][] = [];
  for (let start = 0; start < ids.length; start += MAX_WORK_ITEMS_PER_BATCH) {
    batches.push(ids.slice(start, start + MAX_WORK_ITEMS_PER_BATCH));
  }
  const answers = new Array<WorkItem[]>(batches.length);
  let next = 0;
  const readBatches = async () => {
    while (next < batches.length) {
      const index = next++;
      try {
        answers[index] = await platform.getWorkItemsBatch(projectId, batches[index], fields);
      } catch (error) {
        // The read has failed as a whole, and more questions only add to it if Azure DevOps is asking for fewer.
        next = batches.length;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: MAX_BATCHES_AT_ONCE }, readBatches));
  return answers.flat();
}
