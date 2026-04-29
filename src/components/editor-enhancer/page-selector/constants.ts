const PAGE_COUNT_THRESHOLD = 100;
const PAGE_COUNT = (window as any)?.nfdEditorChat?.pagesCount ?? 101;
export const HAS_LARGE_PAGE_COUNT = PAGE_COUNT > PAGE_COUNT_THRESHOLD;
export const BASE_PAGE_QUERY = { per_page: 100, orderby: "title", order: "asc" };
