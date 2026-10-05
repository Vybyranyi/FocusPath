/**
 * How the day went as a whole, in a few numbers and a few words. All of it is
 * optional: a journal that demands to be written in stops being opened.
 */
export interface JournalEntry {
    _id: string;
    /** ISO 8601 date string, normalised to midnight UTC. */
    day: string;
    /** 1 (low) to 5 (high). */
    mood?: number;
    /** 1 (drained) to 5 (full of it). */
    energy?: number;
    text?: string;
}
