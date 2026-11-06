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
 *   node scripts/crawl-lectures.mjs                 # current semester
 *   node scripts/crawl-lectures.mjs --year 2026 --term 20
 *   node scripts/crawl-lectures.mjs --out lectures.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://sugang.khu.ac.kr";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TERM_LABEL = { 10: "1학기", 20: "2학기", 15: "여름계절", 25: "겨울계절" };

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
	const args = { year: null, term: null, out: "lectures.json", delay: 250 };
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
function currentSemester() {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `fake` is the site's cache-buster: "Fri Nov 06 20:13:59 KST 2026". */
function fakeParam() {
	const parts = Object.fromEntries(
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
	constructor() {
		this.cookies = new Map();
	}

	async get(path, referer) {
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
async function openSession() {
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

/** data_<year>.js assigns `var daehak_<year><term> = {...}` / `major_...`. */
async function loadCodeData(year) {
	const { body } = await new Session().get(`/resources/data/data_${year}.js`);
	if (!body.includes("daehak_"))
		throw new Error(`no college data for ${year} (data_${year}.js)`);
	const ctx = {};
	// The file is plain `var x = {...};` assignments — evaluate into ctx.
	new Function(
		"ctx",
		body.replace(/var\s+(daehak_\d+|major_\d+)\s*=/g, "ctx.$1 =") + "\n",
	)(ctx);
	return ctx;
}

// ------------------------------------------------------------------ scraping

async function fetchLectures({ year, term, majorCd }) {
	const url =
		`/core?attribute=lectListJson&lang=ko&loginYn=N&fake=${fakeParam()}` +
		`&menu=1&search_div=E&p_graduate=H&p_day=&p_time=&p_teach=&p_subjt=` +
		`&p_major=${encodeURIComponent(majorCd)}&p_lang=&p_year=${year}&p_term=${term}` +
		"&lecture_cd=&initYn=Y";

	for (let attempt = 1; attempt <= 4; attempt++) {
		const session = await openSession();
		const { status, body } = await session.get(url, `${BASE}/`);
		if (status === 200 && body.trim().startsWith("{")) {
			const data = JSON.parse(body);
			if (Array.isArray(data.rows)) return data.rows;
		}
		await sleep(500 * attempt);
	}
	throw new Error(
		`lecture query failed for major ${majorCd} (${year}/${term})`,
	);
}

// -------------------------------------------------------------- name matching

const squash = (s) =>
	s
		.normalize("NFKC")
		.replace(/[·․.,&*()\s]/g, "")
		.replace(/(학부|학과|전공)$/u, "");

/** colleges.json names that the registration system now lists differently. */
const RENAMES = { 회계·세무학과: "회계학과" };

/**
 * Match a colleges.json department to a site department row. The site name is
 * "<college> <department> <major>" (e.g. "정경대학 국제통상·금융투자학부
 * 국제통상학"), so compare the last segment only and require a prefix match so
 * that "경영학" does not swallow "빅데이터응용학".
 */
function matchDepartment(catalogueName, major) {
	const want = squash(catalogueName);
	const last = squash(major.nm.split(/\s+/).at(-1) ?? "");
	if (!want || !last) return 0;
	if (last === want) return 100;
	if (last.startsWith(want) || want.startsWith(last))
		return 50 + Math.min(last.length, want.length);
	return 0;
}

function catalogueNameFor(catalogue, collegeName, major) {
	let best = { name: null, score: 0 };
	for (const [name, meta] of Object.entries(catalogue.departments)) {
		if (meta.college !== collegeName) continue;
		const score = matchDepartment(RENAMES[name] ?? name, major);
		if (score > best.score) best = { name, score };
	}
	return best.score ? best.name : null;
}

const compact = (row) => ({
	lectureCd: row.lecture_cd,
	lectureCdDisp: row.lecture_cd_disp,
	name: row.subjt_name,
	subjectCd: row.subjt_cd,
	classCd: row.class_cd,
	professor: row.teach_na,
	credits: Number.parseFloat(row.unit_num) || null,
	grade: Number(row.lect_grade) || null,
	timetable: String(row.timetable ?? "")
		.replace(/<BR>/gi, " / ")
		.trim(),
	fieldGb: row.field_gb,
	language: row.eng_yn_nm || null,
	campus: row.campus_nm,
	capacity: row.comm_limit ?? row.asign_pcnt ?? null,
	applied: row.all_apply ?? null,
	remaining: row.remain ?? null,
	note: String(row.bigo ?? "").trim() || null,
	haksuCode: row.haksu_code || null,
});

// ---------------------------------------------------------------------- main

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(
			"usage: node scripts/crawl-lectures.mjs [--year Y] [--term 10|20|15|25] [--out file]",
		);
		return;
	}
	const fallback = currentSemester();
	const year = args.year ?? fallback.year;
	const term = args.term ?? fallback.term;

	const catalogue = JSON.parse(
		await readFile(join(ROOT, "colleges.json"), "utf8"),
	);
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

	const result = {
		source: `${BASE}/core?attribute=lectListJson`,
		year,
		term,
		termCode: `${year}${term}`,
		semester: `${year}-${TERM_LABEL[term] ?? term}`,
		fetchedAt: new Date().toISOString(),
		fieldGbLegend: {
			11: "전공기초",
			"04": "전공필수",
			"05": "전공선택",
			"06": "교직과",
			14: "중핵교과",
			15: "배분이수교과",
			16: "기초교과",
			17: "자유이수",
			20: "교직전선",
			24: "계절학기전공필수",
			27: "계절학기전공기초",
			"08": "일반선택",
		},
		colleges: [],
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

		const seen = new Set();
		const departments = [];

		for (const dept of deptRows) {
			let rows;
			try {
				rows = await fetchLectures({ year, term, majorCd: dept.cd });
			} catch (error) {
				console.warn(`! ${collegeName} / ${dept.nm}: ${error.message}`);
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
			college: college.enm,
			collegeKo: college.nm,
			collegeCd: college.cd,
			lectureCount: seen.size,
			departments,
		});
	}

	const total = result.colleges.reduce((sum, c) => sum + c.lectureCount, 0);
	const outPath = join(ROOT, args.out);
	await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);

	const matched = new Set(
		result.colleges.flatMap((c) =>
			c.departments.map((d) => d.catalogue).filter(Boolean),
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
