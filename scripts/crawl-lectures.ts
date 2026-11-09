#!/usr/bin/env node
/**
 * Scrape the Kyung Hee course timetable ("종합시간표 조회") for the colleges
 * listed in colleges.json.
 *
 * How the site works (sugang.khu.ac.kr):
 *   1. /                      -> frameset shell, sets SUGANGSESSIONID
 *   2. /login?attribute=loginFrame
 *                             -> loads /login?attribute=loginMain (menu page)
 *   3. menu item onclick="fnLoad(urlCoreLectureList,'this')"
 *                             -> /core?attribute=coreLectureList renders the
 *                                search form: #p_year, #p_term, #p_daehak
 *                                (college select, filled from
 *                                /resources/data/data_<year>.js), #p_major
 *   4. selecting a college in #p_daehak filters #p_major to the departments
 *      whose `dh` equals the college code; the grid then requests
 *      /core?attribute=lectListJson&...&p_major=<department code>
 *      A college code alone returns no rows — lectures are keyed by
 *      department code, so we query every department of the college.
 *
 * The session is single-use for lectListJson (a second call on the same
 * session returns the site's "page not found" page), so each query gets a
 * fresh session.
 *
 * Usage:
 *   node scripts/crawl-lectures.ts                 # current semester
 *   node scripts/crawl-lectures.ts --year 2026 --term 20
 *   node scripts/crawl-lectures.ts --out other.json
 *
 * The timetable is merged under the `offerings` key of the target file, so the
 * default run rewrites only that block of colleges.json and leaves the curated
 * `collegeAliases` / `departments` sections untouched.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://sugang.khu.ac.kr";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TERM_LABEL: Record<number, string> = {
	10: "1학기",
	20: "2학기",
	15: "여름계절",
	25: "겨울계절",
};

// ---------------------------------------------------------------- arguments

interface Args {
	year: number | null;
	term: number | null;
	out: string;
	delay: number;
	help?: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { year: null, term: null, out: "colleges.json", delay: 250 };
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i];
		const next = argv[i + 1];
		if (key === "--year") {
			args.year = Number(next);
			i++;
		} else if (key === "--term") {
			args.term = Number(next);
			i++;
		} else if (key === "--out") {
			args.out = next;
			i++;
		} else if (key === "--delay") {
			args.delay = Number(next);
			i++;
		} else if (key === "--help" || key === "-h") {
			args.help = true;
		} else {
			throw new Error(`unknown argument: ${key}`);
		}
	}
	return args;
}

/** Current Korean semester: Mar–Aug -> term 10, otherwise term 20. */
function currentSemester(): { year: number; term: number } {
	const now = new Date();
	const month = Number(
		new Intl.DateTimeFormat("en-US", {
			timeZone: "Asia/Seoul",
			month: "numeric",
		}).format(now),
	);
	return { year: now.getFullYear(), term: month >= 3 && month <= 8 ? 10 : 20 };
}

// ------------------------------------------------------------------ network

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** `fake` is the site's cache-buster: "Fri Nov 06 20:13:59 KST 2026". */
function fakeParam(): string {
	const parts: Record<string, string> = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: "Asia/Seoul",
			weekday: "short",
			month: "short",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
			year: "numeric",
		})
			.formatToParts(new Date())
			.map((p) => [p.type, p.value]),
	);
	return encodeURIComponent(
		`${parts.weekday} ${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST ${parts.year}`,
	);
}

class Session {
	private cookies = new Map<string, string>();

	async get(
		path: string,
		referer?: string,
	): Promise<{ status: number; body: string }> {
		const url = path.startsWith("http") ? path : BASE + path;
		const res = await fetch(url, {
			headers: {
				"user-agent": UA,
				"accept-language": "ko-KR,ko;q=0.9",
				accept: "text/html,application/json,*/*",
				...(referer ? { referer } : {}),
				...(this.cookies.size
					? {
							cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
						}
					: {}),
			},
			redirect: "follow",
		});
		for (const cookie of res.headers.getSetCookie?.() ?? []) {
			const pair = cookie.split(";")[0];
			const eq = pair.indexOf("=");
			if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
		}
		return { status: res.status, body: await res.text() };
	}
}

/** Fresh session primed exactly like a browser walking to 종합시간표 조회. */
async function openSession(): Promise<Session> {
	const session = new Session();
	await session.get("/");
	await session.get("/login?attribute=loginFrame&fake=1", `${BASE}/`);
	await session.get(
		`/core?attribute=coreLectureList&lang=ko&loginYn=N&fake=${fakeParam()}`,
		`${BASE}/`,
	);
	return session;
}

// ------------------------------------------------------------- site metadata

interface CodeRow {
	cd: string;
	nm: string;
	enm?: string;
	dh?: string;
	orgnz_outpt_ord?: string | null;
	orgnz_lvl_se_code?: string | null;
}

interface CodeData {
	[key: string]: { rows: CodeRow[] } | undefined;
}

/** data_<year>.js assigns `var daehak_<year><term> = {...}` / `major_...`. */
async function loadCodeData(year: number): Promise<CodeData> {
	const { body } = await new Session().get(`/resources/data/data_${year}.js`);
	if (!body.includes("daehak_"))
		throw new Error(`no college data for ${year} (data_${year}.js)`);
	const ctx: Record<string, unknown> = {};
	// The file is plain `var x = {...};` assignments — evaluate into ctx.
	new Function(
		"ctx",
		body.replace(/var\s+(daehak_\d+|major_\d+)\s*=/g, "ctx.$1 =") + "\n",
	)(ctx);
	return ctx as unknown as CodeData;
}

// ------------------------------------------------------------------ scraping

interface LectureRow {
	lecture_cd: string;
	subjt_cd: string;
	subjt_name: string;
	unit_num: string | null;
	field_gb: string;
	campus_nm: string;
	bigo?: string | null;
}

async function fetchLectures({
	year,
	term,
	majorCd,
}: {
	year: number;
	term: number;
	majorCd: string;
}): Promise<LectureRow[]> {
	const url =
		`/core?attribute=lectListJson&lang=ko&loginYn=N&fake=${fakeParam()}` +
		`&menu=1&search_div=E&p_graduate=H&p_day=&p_time=&p_teach=&p_subjt=` +
		`&p_major=${encodeURIComponent(majorCd)}&p_lang=&p_year=${year}&p_term=${term}` +
		"&lecture_cd=&initYn=Y";

	for (let attempt = 1; attempt <= 4; attempt++) {
		const session = await openSession();
		const { status, body } = await session.get(url, `${BASE}/`);
		if (status === 200 && body.trim().startsWith("{")) {
			const data = JSON.parse(body) as { rows?: LectureRow[] };
			if (Array.isArray(data.rows)) return data.rows;
		}
		await sleep(500 * attempt);
	}
	throw new Error(
		`lecture query failed for major ${majorCd} (${year}/${term})`,
	);
}

// -------------------------------------------------------------- name matching

const squash = (s: string): string =>
	s
		.normalize("NFKC")
		.replace(/[·․.,&*()\s]/g, "")
		.replace(/(학부|학과|전공)$/u, "");

/** colleges.json names that the registration system now lists differently. */
const RENAMES: Record<string, string> = { "회계·세무학과": "회계학과" };

/**
 * Match a colleges.json department to a site department row. The site name is
 * "<college> <department> <major>" (e.g. "정경대학 국제통상·금융투자학부
 * 국제통상학"), so compare the last segment only and require a prefix match so
 * that "경영학" does not swallow "빅데이터응용학".
 */
function matchDepartment(catalogueName: string, major: CodeRow): number {
	const want = squash(catalogueName);
	const last = squash(major.nm.split(/\s+/).at(-1) ?? "");
	if (!want || !last) return 0;
	if (last === want) return 100;
	if (last.startsWith(want) || want.startsWith(last))
		return 50 + Math.min(last.length, want.length);
	return 0;
}

interface Catalogue {
	departments: Record<string, { college: string }>;
}

function catalogueNameFor(
	catalogue: Catalogue,
	collegeName: string,
	major: CodeRow,
): string | null {
	let best = { name: null as string | null, score: 0 };
	for (const [name, meta] of Object.entries(catalogue.departments)) {
		if (meta.college !== collegeName) continue;
		const score = matchDepartment(RENAMES[name] ?? name, major);
		if (score > best.score) best = { name, score };
	}
	return best.score ? best.name : null;
}

interface Lecture {
	subjectCd: string;
	name: string;
	credits: number | null;
	fieldGb: string;
	campus: string;
	note: string | null;
}

const compact = (row: LectureRow): Lecture => ({
	subjectCd: row.subjt_cd,
	name: row.subjt_name,
	credits: Number.parseFloat(String(row.unit_num)) || null,
	fieldGb: row.field_gb,
	campus: row.campus_nm,
	note: String(row.bigo ?? "").trim() || null,
});

// ---------------------------------------------------------------------- main

interface DepartmentResult {
	name: string;
	code: string;
	level: number | null;
	catalogue: string | null;
	lectureCount: number;
	lectures: Lecture[];
}

interface CollegeResult {
	college: string;
	collegeKo: string;
	collegeCd: string;
	lectureCount: number;
	departments: DepartmentResult[];
}

/** The timetable body, stored under `offerings` in the merged document. */
interface Offerings {
	source: string;
	year: number;
	term: number;
	termCode: string;
	semester: string;
	fetchedAt: string;
	fieldGbLegend: Record<string, { ko: string; en: string }>;
	colleges: CollegeResult[];
}

// ------------------------------------------------------------------- writing

const readTextIfExists = async (path: string): Promise<string | null> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
};

/** Re-indent a pretty-printed JSON block so it sits at column `n`. */
const indent = (text: string, n: number): string =>
	text.replace(/\n/g, `\n${" ".repeat(n)}`);

/** Old `lectures.json` shape: timetable fields at the top level. */
function isStandaloneTimetable(text: string): boolean {
	const parsed = JSON.parse(text) as Record<string, unknown>;
	return Array.isArray(parsed.colleges) && !("departments" in parsed);
}

/**
 * Merge the timetable into an existing document (`colleges.json` by default)
 * without reflowing it: the curated `collegeAliases` / `departments` sections
 * keep their hand-written formatting and only the trailing `offerings` member
 * is rewritten. A previous standalone timetable file is replaced wholesale.
 */
function mergeOfferings(existing: string | null, offerings: Offerings): string {
	const block = indent(JSON.stringify(offerings, null, 2), 2);
	const text = existing?.trimEnd() ? existing.trimEnd() : null;

	if (!text || isStandaloneTimetable(text)) {
		return `{\n  "offerings": ${block}\n}\n`;
	}
	if (!text.endsWith("}")) {
		throw new Error("cannot merge: target file is not a JSON object");
	}

	let prefix = text.slice(0, -1);
	const previous = /\n[ \t]*"offerings"[ \t]*:/.exec(prefix);
	if (previous) prefix = prefix.slice(0, previous.index);
	prefix = prefix.trimEnd();
	if (prefix.endsWith(",")) prefix = prefix.slice(0, -1);

	const separator = prefix.endsWith("{") ? "" : ",";
	const merged = `${prefix}${separator}\n  "offerings": ${block}\n}\n`;

	// Fail loudly rather than corrupt a curated file.
	const parsed = JSON.parse(merged) as Record<string, unknown>;
	for (const key of Object.keys(parsed)) {
		if (!["collegeAliases", "departments", "offerings"].includes(key)) {
			console.warn(`! merged file keeps unknown top-level key: ${key}`);
		}
	}
	return merged;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(
			"usage: node scripts/crawl-lectures.ts [--year Y] [--term 10|20|15|25] [--out colleges.json]",
		);
		return;
	}
	const fallback = currentSemester();
	const year = args.year ?? fallback.year;
	const term = args.term ?? fallback.term;

	const catalogue = JSON.parse(
		await readFile(join(ROOT, "colleges.json"), "utf8"),
	) as Catalogue;
	const colleges = [
		...new Set(Object.values(catalogue.departments).map((d) => d.college)),
	];

	const codeData = await loadCodeData(year);
	const collegeRows = codeData[`daehak_${year}${term}`];
	const majorRows = codeData[`major_${year}${term}`];
	if (!collegeRows || !majorRows) {
		const available = Object.keys(codeData).filter((k) =>
			k.startsWith("daehak_"),
		);
		throw new Error(
			`no course data for ${year}/${term}; available: ${available.join(", ")}`,
		);
	}

	console.log(
		`sugang.khu.ac.kr — ${year}-${TERM_LABEL[term] ?? term} (${year}${term})`,
	);

	const result: Offerings = {
		source: `${BASE}/core?attribute=lectListJson`,
		year,
		term,
		termCode: `${year}${term}`,
		semester: `${year}-${TERM_LABEL[term] ?? term}`,
		fetchedAt: new Date().toISOString(),
		fieldGbLegend: {
			11: { ko: "전공기초", en: "Basic Major Studies" },
			"04": { ko: "전공필수", en: "Essential Major Studies" },
			"05": { ko: "전공선택", en: "Elective Major Studies" },
			"06": { ko: "교직과", en: "Teaching Profession" },
			14: { ko: "중핵교과", en: "Core Courses" },
			15: { ko: "배분이수교과", en: "Distribution Requirements" },
			16: { ko: "기초교과", en: "Required Fundamentals" },
			17: { ko: "자유이수", en: "Electives" },
			20: { ko: "교직전선", en: "Teaching Profession Elective" },
			24: { ko: "계절학기전공필수", en: "Seasonal Major Required" },
			27: { ko: "계절학기전공기초", en: "Seasonal Major Foundation" },
			"08": { ko: "일반선택", en: "General Elective" },
		},
		colleges: [] as CollegeResult[],
	};

	for (const collegeName of colleges) {
		const college = collegeRows.rows.find((r) => r.nm === collegeName);
		if (!college) {
			console.warn(`! college not found on site: ${collegeName}`);
			continue;
		}
		// Departments of this college: rows whose parent is the college, minus the
		// college row itself (a college-level query returns no lectures).
		const deptRows = majorRows.rows
			.filter((r) => r.dh === college.cd && r.cd !== college.cd)
			.sort(
				(a, b) =>
					(a.orgnz_outpt_ord ?? "").localeCompare(b.orgnz_outpt_ord ?? "") ||
					(a.orgnz_lvl_se_code ?? "").localeCompare(b.orgnz_lvl_se_code ?? ""),
			);

		const seen = new Set<string>();
		const departments: DepartmentResult[] = [];

		for (const dept of deptRows) {
			let rows: LectureRow[];
			try {
				rows = await fetchLectures({ year, term, majorCd: dept.cd });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`! ${collegeName} / ${dept.nm}: ${message}`);
				rows = [];
			}
			const lectures = rows.filter((r) => !seen.has(r.lecture_cd));
			for (const r of lectures) seen.add(r.lecture_cd);

			const catalogueName = catalogueNameFor(catalogue, collegeName, dept);

			departments.push({
				name:
					dept.nm.replace(new RegExp(`^${collegeName}\\s*`), "").trim() ||
					dept.nm,
				code: dept.cd,
				level: Number(dept.orgnz_lvl_se_code) || null,
				catalogue: catalogueName,
				lectureCount: lectures.length,
				lectures: lectures.map(compact),
			});
			process.stdout.write(
				`  ${collegeName} / ${dept.nm}: ${lectures.length}\n`,
			);
			await sleep(args.delay);
		}

		result.colleges.push({
			college: college.enm ?? college.nm,
			collegeKo: college.nm,
			collegeCd: college.cd,
			lectureCount: seen.size,
			departments,
		});
	}

	const total = result.colleges.reduce((sum, c) => sum + c.lectureCount, 0);
	const outPath = join(ROOT, args.out);
	await writeFile(
		outPath,
		mergeOfferings(await readTextIfExists(outPath), result),
	);

	const matched = new Set(
		result.colleges.flatMap((c) =>
			c.departments
				.map((d) => d.catalogue)
				.filter((v): v is string => Boolean(v)),
		),
	);
	const unmatched = Object.keys(catalogue.departments).filter(
		(name) => !matched.has(name),
	);
	for (const name of unmatched)
		console.warn(`! not offered this term: ${name}`);

	console.log(
		`\n${total} lectures across ${result.colleges.length} colleges -> ${outPath}`,
	);
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
