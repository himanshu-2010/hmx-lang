import storyData from "./story.json";

/** A single dated entry in a chapter's timeline. */
export interface StoryEntry {
  date: string;
  title: string;
  detail?: string;
  /** "done" | "current" | "planned"; unknown values render as a neutral note. */
  status?: string;
}

/** One chapter ("How it started", "How it's going", "What's left …"). */
export interface StoryChapter {
  /** Stable slug, used as the DOM id the chapter nav scrolls to. */
  id: string;
  title: string;
  body?: string;
  entries: StoryEntry[];
}

export interface StoryStats {
  version: string;
  nativeTests: number;
  packagingTests: number;
  vitest: number;
  valgrind: number;
}

export interface Story {
  updatedAt: string;
  title: string;
  intro: string;
  stats: StoryStats;
  chapters: StoryChapter[];
}

/**
 * The Story page renders this object directly, so `story.json` is the single
 * source of truth: add a chapter or an entry there and it appears on the page.
 * The packaging gate (§12f, "story.json is well-formed") validates its shape and
 * pins `stats.version` to the canonical CMakeLists version.
 */
const story = storyData as Story;

export default story;
