import { useState } from "react";
import {
	bumpMoreClicks,
	clearMoreClicks,
	EMPTY_MORE_CLICKS,
	type MoreClicksMap,
} from "../../lib/sidebar-visible-count";
import { useExpandedGroups } from "./useExpandedGroups";

type SearchOverrides = Readonly<Record<string, boolean>>;

const EMPTY_OVERRIDES: SearchOverrides = {};

type SearchState = {
	term: string;
	overrides: SearchOverrides;
	clicks: MoreClicksMap;
};

const emptySearchState = (term: string): SearchState => ({
	term,
	overrides: EMPTY_OVERRIDES,
	clicks: EMPTY_MORE_CLICKS,
});

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
	if (!(key in record)) return record;
	const next: Record<string, T> = { ...record };
	delete next[key];
	return next;
}

export function useSidebarBatching({ search, defaults }: { search: string; defaults: readonly string[] }) {
	const searching = search.trim().length > 0;
	const { toggleGroup: persistToggle } = useExpandedGroups();
	const [normalClicks, setNormalClicks] = useState<MoreClicksMap>(EMPTY_MORE_CLICKS);
	const [searchState, setSearchState] = useState<SearchState>(() => emptySearchState(search));

	if (searchState.term !== search) setSearchState(emptySearchState(search));

	return {
		searching,

		isExpanded: (key: string, persistedExpanded: boolean) =>
			searching ? (searchState.overrides[key] ?? true) : persistedExpanded,

		moreClicks: (key: string) => (searching ? searchState.clicks[key] : normalClicks[key]) ?? 0,
		showMore: (key: string) => {
			if (searching) {
				setSearchState((prev) => ({ ...prev, clicks: bumpMoreClicks(prev.clicks, key) }));
				return;
			}
			setNormalClicks((prev) => bumpMoreClicks(prev, key));
		},

		toggleGroup: (key: string, nextExpanded: boolean) => {
			if (searching) {
				setSearchState((prev) => ({
					...prev,
					overrides: { ...prev.overrides, [key]: nextExpanded },

					clicks: nextExpanded ? clearMoreClicks(prev.clicks, key) : prev.clicks,
				}));
				return;
			}

			if (!nextExpanded) setNormalClicks((prev) => clearMoreClicks(prev, key));
			persistToggle(key, defaults);
		},

		forget: (key: string) => {
			setNormalClicks((prev) => clearMoreClicks(prev, key));
			setSearchState((prev) => ({
				...prev,
				overrides: withoutKey(prev.overrides, key),
				clicks: clearMoreClicks(prev.clicks, key),
			}));
		},
	};
}

export type SidebarBatching = ReturnType<typeof useSidebarBatching>;
