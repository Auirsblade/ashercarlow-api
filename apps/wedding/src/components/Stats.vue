<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import stats from '../assets/stats.json'

const router = useRouter()

const HOUR_LABELS = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
                     '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p']
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const fmtNum = (n) => Number(n).toLocaleString('en-US')
const fmtDate = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const fmtDateShort = (ymdStr) => {
    if (!ymdStr) return ''
    const [y, m, d] = ymdStr.split('-')
    return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const fmtDuration = (ms) => {
    if (!ms) return '—'
    const sec = ms / 1000
    if (sec < 90) return `${Math.round(sec)}s`
    const min = sec / 60
    if (min < 90) return `${Math.round(min)}m`
    return `${(min / 60).toFixed(1)}h`
}

// Hour-of-day chart geometry
const hourMax = computed(() => Math.max(...stats.timeOfDay.map(t => t.count)))
const hourBars = computed(() => stats.timeOfDay.map(t => ({
    ...t,
    label: HOUR_LABELS[t.hour],
    pct: t.count / hourMax.value,
})))

// Day-of-week chart
const dowMax = computed(() => Math.max(...stats.dayOfWeek.map(d => d.count)))
const dowBars = computed(() => stats.dayOfWeek.map(d => ({
    ...d,
    label: DOW_LABELS[d.dow],
    pct: d.count / dowMax.value,
})))

// Monthly line chart
const monthChart = computed(() => {
    const series = stats.monthSeries
    if (!series.length) return { points: '', area: '', xLabels: [], maxCount: 0, ticks: [] }
    const w = 1000
    const h = 240
    const pad = { l: 36, r: 12, t: 12, b: 28 }
    const max = Math.max(...series.map(s => s.count))
    const xStep = (w - pad.l - pad.r) / Math.max(series.length - 1, 1)
    const yScale = (c) => h - pad.b - (c / max) * (h - pad.t - pad.b)
    const pts = series.map((s, i) => ({
        x: pad.l + i * xStep,
        y: yScale(s.count),
        month: s.month,
        count: s.count,
    }))
    const points = pts.map(p => `${p.x},${p.y}`).join(' ')
    const area = `M ${pts[0].x},${h - pad.b} L ` +
        pts.map(p => `${p.x},${p.y}`).join(' L ') +
        ` L ${pts[pts.length - 1].x},${h - pad.b} Z`
    // Year tick labels — show first month of each year
    const xLabels = []
    let lastYear = null
    for (let i = 0; i < series.length; i++) {
        const y = series[i].month.slice(0, 4)
        if (y !== lastYear) {
            xLabels.push({ x: pad.l + i * xStep, label: y })
            lastYear = y
        }
    }
    // Y ticks (0, max/2, max, rounded)
    const ticks = [0, Math.round(max / 2), max].map(v => ({ v, y: yScale(v) }))
    return { points, area, xLabels, ticks, w, h, pad, pts }
})

// Sender split (donut)
const senderSplit = computed(() => {
    const total = stats.totals.fromMe + stats.totals.fromHer
    const mePct = stats.totals.fromMe / total
    const herPct = stats.totals.fromHer / total
    // Donut: full circumference 2πr; we draw two arcs.
    const r = 70
    const c = 2 * Math.PI * r
    return {
        meDash: `${c * mePct} ${c}`,
        herDash: `${c * herPct} ${c}`,
        herOffset: -c * mePct,
        meLabel: `${Math.round(mePct * 100)}%`,
        herLabel: `${Math.round(herPct * 100)}%`,
    }
})

// Best/worst sender ratios for display
const heaviestEmoji = computed(() => stats.topEmojis[0])

// Years between first and last message — keeps the headline truthful as more
// data accrues without manual edits.
const yearsTexting = computed(() => {
    const first = new Date(stats.range.firstMessage)
    const last = new Date(stats.range.lastMessage)
    return Math.floor((last - first) / (365.25 * 24 * 60 * 60 * 1000))
})
const goHome = () => router.push('/')
</script>

<template>
    <div class="bg-beige text-lime-950 min-h-svh font-serif">
        <!-- Hero -->
        <header class="text-center px-4 pt-10 pb-8">
            <div class="text-4xl lg:text-6xl">By the Numbers</div>
            <div class="mt-3 text-xl lg:text-2xl text-lime-950/70">
                {{ yearsTexting }}+ years of texts between Paulina &amp; Asher
            </div>
            <div class="mt-2 text-base lg:text-lg text-lime-950/60">
                {{ fmtDate(stats.range.firstMessage) }} – {{ fmtDate(stats.range.lastMessage) }}
            </div>
        </header>

        <!-- Headline grid -->
        <section class="max-w-5xl mx-auto px-4 grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-6">
            <div class="border border-lime-950/20 rounded-lg p-5 text-center bg-beige">
                <div class="text-4xl lg:text-5xl font-semibold">{{ fmtNum(stats.totals.messages) }}</div>
                <div class="text-base lg:text-lg mt-1 text-lime-950/70">messages</div>
            </div>
            <div class="border border-lime-950/20 rounded-lg p-5 text-center">
                <div class="text-4xl lg:text-5xl font-semibold">{{ fmtNum(stats.totals.words) }}</div>
                <div class="text-base lg:text-lg mt-1 text-lime-950/70">words</div>
            </div>
            <div class="border border-lime-950/20 rounded-lg p-5 text-center">
                <div class="text-4xl lg:text-5xl font-semibold">{{ fmtNum(stats.range.daysWithMessages) }}</div>
                <div class="text-base lg:text-lg mt-1 text-lime-950/70">
                    days texting <span class="text-sm">({{ stats.range.coveragePct }}% of {{ fmtNum(stats.range.daysSpan) }})</span>
                </div>
            </div>
            <div class="border border-lime-950/20 rounded-lg p-5 text-center">
                <div class="text-4xl lg:text-5xl font-semibold">{{ stats.averages.messagesPerDay }}</div>
                <div class="text-base lg:text-lg mt-1 text-lime-950/70">avg per day</div>
            </div>
        </section>

        <hr class="border-lime-950/20 my-10 mx-4" />

        <!-- Sender split donut + headline phrases -->
        <section class="max-w-5xl mx-auto px-4 grid lg:grid-cols-2 gap-8 items-center">
            <div class="text-center">
                <div class="text-3xl lg:text-4xl mb-4">Who texts more?</div>
                <div class="flex justify-center">
                    <svg viewBox="0 0 200 200" class="w-64 h-64" aria-label="Sender split donut">
                        <circle cx="100" cy="100" r="70" fill="none"
                                stroke="rgba(20, 83, 45, 0.15)" stroke-width="22" />
                        <circle cx="100" cy="100" r="70" fill="none"
                                stroke="#3f6212" stroke-width="22"
                                :stroke-dasharray="senderSplit.meDash"
                                stroke-dashoffset="0"
                                transform="rotate(-90 100 100)" />
                        <circle cx="100" cy="100" r="70" fill="none"
                                stroke="#a16207" stroke-width="22"
                                :stroke-dasharray="senderSplit.herDash"
                                :stroke-dashoffset="senderSplit.herOffset"
                                transform="rotate(-90 100 100)" />
                        <text x="100" y="92" text-anchor="middle" font-size="14"
                              fill="currentColor" class="font-serif">
                            {{ fmtNum(stats.totals.messages) }}
                        </text>
                        <text x="100" y="112" text-anchor="middle" font-size="11"
                              fill="currentColor" opacity="0.6" class="font-serif">
                            messages
                        </text>
                    </svg>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-3 max-w-sm mx-auto text-lg">
                    <div>
                        <div class="flex items-center justify-center gap-2">
                            <span class="inline-block w-3 h-3 rounded-sm" style="background:#3f6212"></span>
                            <strong>Asher</strong>
                        </div>
                        <div class="text-2xl mt-1">{{ fmtNum(stats.totals.fromMe) }}</div>
                        <div class="text-sm text-lime-950/60">{{ senderSplit.meLabel }}</div>
                    </div>
                    <div>
                        <div class="flex items-center justify-center gap-2">
                            <span class="inline-block w-3 h-3 rounded-sm" style="background:#a16207"></span>
                            <strong>Paulina</strong>
                        </div>
                        <div class="text-2xl mt-1">{{ fmtNum(stats.totals.fromHer) }}</div>
                        <div class="text-sm text-lime-950/60">{{ senderSplit.herLabel }}</div>
                    </div>
                </div>
            </div>

            <div class="space-y-3">
                <div class="border border-lime-950/20 rounded-lg p-5 flex justify-between items-baseline">
                    <div>
                        <div class="text-2xl lg:text-3xl">"I love you"</div>
                        <div class="text-sm text-lime-950/60">incl. love u, ily, etc.</div>
                    </div>
                    <div class="text-3xl lg:text-4xl font-semibold">{{ fmtNum(stats.phrases.iLoveYouTotal) }}</div>
                </div>
                <div class="border border-lime-950/20 rounded-lg p-5 flex justify-between items-baseline">
                    <div>
                        <div class="text-2xl lg:text-3xl">"Good morning"</div>
                        <div class="text-sm text-lime-950/60">most-quoted phrase</div>
                    </div>
                    <div class="text-3xl lg:text-4xl font-semibold">{{ fmtNum(stats.phrases.goodMorningTotal) }}</div>
                </div>
                <div class="border border-lime-950/20 rounded-lg p-5 flex justify-between items-baseline">
                    <div>
                        <div class="text-2xl lg:text-3xl">"Good night"</div>
                        <div class="text-sm text-lime-950/60">said in person, mostly</div>
                    </div>
                    <div class="text-3xl lg:text-4xl font-semibold">{{ fmtNum(stats.phrases.goodNightTotal) }}</div>
                </div>
                <div class="border border-lime-950/20 rounded-lg p-5 flex justify-between items-baseline">
                    <div>
                        <div class="text-2xl lg:text-3xl">Laughs</div>
                        <div class="text-sm text-lime-950/60">haha / lol / lmao</div>
                    </div>
                    <div class="text-3xl lg:text-4xl font-semibold">{{ fmtNum(stats.phrases.laughsTotal) }}</div>
                </div>
            </div>
        </section>

        <hr class="border-lime-950/20 my-10 mx-4" />

        <!-- Hour of day -->
        <section class="max-w-5xl mx-auto px-4">
            <div class="text-3xl lg:text-4xl text-center mb-6">When do we text?</div>
            <div class="border border-lime-950/20 rounded-lg p-4 lg:p-6">
                <svg :viewBox="`0 0 720 220`" class="w-full" preserveAspectRatio="none"
                     style="height: 220px" aria-label="Messages by hour of day">
                    <g v-for="(b, i) in hourBars" :key="i">
                        <rect :x="i * 30 + 2" :y="200 - b.pct * 180"
                              width="26" :height="b.pct * 180"
                              fill="#3f6212" opacity="0.85"
                              :rx="2" />
                        <text :x="i * 30 + 15" y="215" text-anchor="middle"
                              font-size="10" fill="currentColor" opacity="0.6">
                            {{ b.label }}
                        </text>
                    </g>
                </svg>
                <div class="text-sm text-lime-950/60 text-center mt-2">Times shown in your local time</div>
            </div>
        </section>

        <!-- Day of week -->
        <section class="max-w-3xl mx-auto px-4 mt-10">
            <div class="text-3xl lg:text-4xl text-center mb-6">Which day?</div>
            <div class="border border-lime-950/20 rounded-lg p-4 lg:p-6">
                <svg :viewBox="`0 0 700 200`" class="w-full" preserveAspectRatio="none"
                     style="height: 200px" aria-label="Messages by day of week">
                    <g v-for="(b, i) in dowBars" :key="i">
                        <rect :x="i * 100 + 18" :y="170 - b.pct * 150"
                              width="64" :height="b.pct * 150"
                              fill="#3f6212" opacity="0.85"
                              :rx="3" />
                        <text :x="i * 100 + 50" :y="170 - b.pct * 150 - 6"
                              text-anchor="middle" font-size="14" fill="currentColor" opacity="0.7">
                            {{ fmtNum(b.count) }}
                        </text>
                        <text :x="i * 100 + 50" y="190" text-anchor="middle"
                              font-size="14" fill="currentColor" opacity="0.7">
                            {{ b.label }}
                        </text>
                    </g>
                </svg>
            </div>
        </section>

        <!-- Messages over time -->
        <section class="max-w-5xl mx-auto px-4 mt-10">
            <div class="text-3xl lg:text-4xl text-center mb-6">Messages over time</div>
            <div class="border border-lime-950/20 rounded-lg p-4 lg:p-6">
                <svg :viewBox="`0 0 ${monthChart.w} ${monthChart.h}`" class="w-full"
                     preserveAspectRatio="none" style="height: 240px">
                    <!-- Y gridlines -->
                    <g v-for="t in monthChart.ticks" :key="`tick-${t.v}`">
                        <line :x1="monthChart.pad.l" :x2="monthChart.w - monthChart.pad.r"
                              :y1="t.y" :y2="t.y"
                              stroke="rgba(20, 83, 45, 0.15)" stroke-width="1" />
                        <text :x="monthChart.pad.l - 6" :y="t.y + 4" text-anchor="end"
                              font-size="11" fill="currentColor" opacity="0.5">
                            {{ fmtNum(t.v) }}
                        </text>
                    </g>
                    <!-- Area + line -->
                    <path :d="monthChart.area" fill="#3f6212" opacity="0.18" />
                    <polyline :points="monthChart.points" fill="none" stroke="#3f6212"
                              stroke-width="2" stroke-linejoin="round" />
                    <!-- Year labels -->
                    <g v-for="x in monthChart.xLabels" :key="`yr-${x.label}`">
                        <line :x1="x.x" :x2="x.x"
                              :y1="monthChart.h - monthChart.pad.b"
                              :y2="monthChart.h - monthChart.pad.b + 4"
                              stroke="currentColor" opacity="0.3" />
                        <text :x="x.x" :y="monthChart.h - 8" text-anchor="middle"
                              font-size="11" fill="currentColor" opacity="0.6">
                            {{ x.label }}
                        </text>
                    </g>
                </svg>
            </div>
        </section>

        <hr class="border-lime-950/20 my-10 mx-4" />

        <!-- Top emojis -->
        <section class="max-w-5xl mx-auto px-4">
            <div class="text-3xl lg:text-4xl text-center mb-6">Top emojis</div>
            <div class="border border-lime-950/20 rounded-lg p-4 lg:p-6">
                <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                    <div v-for="e in stats.topEmojis" :key="e.key"
                         class="text-center">
                        <div class="text-5xl lg:text-6xl">{{ e.key }}</div>
                        <div class="text-base lg:text-lg mt-1 text-lime-950/70">{{ fmtNum(e.count) }}</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Response time + words per message -->
        <section class="max-w-5xl mx-auto px-4 mt-10 grid lg:grid-cols-2 gap-6">
            <div class="border border-lime-950/20 rounded-lg p-5 text-center">
                <div class="text-2xl lg:text-3xl mb-3">Median response time</div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <div class="text-3xl lg:text-4xl font-semibold">
                            {{ fmtDuration(stats.averages.responseTimeMedianMsMe) }}
                        </div>
                        <div class="text-sm text-lime-950/60">Asher</div>
                    </div>
                    <div>
                        <div class="text-3xl lg:text-4xl font-semibold">
                            {{ fmtDuration(stats.averages.responseTimeMedianMsHer) }}
                        </div>
                        <div class="text-sm text-lime-950/60">Paulina</div>
                    </div>
                </div>
                <div class="text-sm text-lime-950/50 mt-3">capped at 6 hours</div>
            </div>
            <div class="border border-lime-950/20 rounded-lg p-5 text-center">
                <div class="text-2xl lg:text-3xl mb-3">Words per message</div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <div class="text-3xl lg:text-4xl font-semibold">
                            {{ stats.averages.wordsPerMessageMe }}
                        </div>
                        <div class="text-sm text-lime-950/60">Asher</div>
                    </div>
                    <div>
                        <div class="text-3xl lg:text-4xl font-semibold">
                            {{ stats.averages.wordsPerMessageHer }}
                        </div>
                        <div class="text-sm text-lime-950/60">Paulina</div>
                    </div>
                </div>
            </div>
        </section>

        <hr class="border-lime-950/20 my-10 mx-4" />

        <!-- Top non-stopwords -->
        <section class="max-w-5xl mx-auto px-4">
            <div class="text-3xl lg:text-4xl text-center mb-6">Most-used words</div>
            <div class="border border-lime-950/20 rounded-lg p-5 flex flex-wrap justify-center gap-3 text-lg">
                <span v-for="(w, i) in stats.topWords.slice(0, 20)" :key="w.key"
                      class="inline-flex items-baseline gap-1 px-3 py-1 rounded-full bg-lime-950/10"
                      :style="{ fontSize: (1 + (1 - i / 20) * 0.6) + 'rem' }">
                    <strong>{{ w.key }}</strong>
                    <span class="text-sm text-lime-950/60">{{ fmtNum(w.count) }}</span>
                </span>
            </div>
        </section>

        <hr class="border-lime-950/20 my-10 mx-4" />

        <!-- Superlatives -->
        <section class="max-w-5xl mx-auto px-4 grid lg:grid-cols-3 gap-6">
            <div class="border border-lime-950/20 rounded-lg p-6 text-center">
                <div class="text-xl text-lime-950/70 mb-2">Longest streak</div>
                <div class="text-4xl lg:text-5xl font-semibold">{{ stats.longestStreak.days }}</div>
                <div class="text-base text-lime-950/70 mt-1">consecutive days</div>
                <div class="text-sm text-lime-950/60 mt-3">
                    {{ fmtDateShort(stats.longestStreak.start) }} →
                    {{ fmtDateShort(stats.longestStreak.end) }}
                </div>
            </div>
            <div class="border border-lime-950/20 rounded-lg p-6 text-center">
                <div class="text-xl text-lime-950/70 mb-2">Chattiest day</div>
                <div class="text-4xl lg:text-5xl font-semibold">{{ fmtNum(stats.longestDay.count) }}</div>
                <div class="text-base text-lime-950/70 mt-1">messages</div>
                <div class="text-sm text-lime-950/60 mt-3">
                    {{ fmtDateShort(stats.longestDay.date) }}
                </div>
            </div>
            <div class="border border-lime-950/20 rounded-lg p-6 text-center">
                <div class="text-xl text-lime-950/70 mb-2">Top emoji</div>
                <div class="text-6xl lg:text-7xl">{{ heaviestEmoji.key }}</div>
                <div class="text-base text-lime-950/70 mt-1">used {{ fmtNum(heaviestEmoji.count) }} times</div>
            </div>
        </section>

        <!-- Footer -->
        <footer class="text-center mt-16 mb-10 px-4">
            <button @click="goHome"
                    class="bg-lime-950/70 text-stone-200 hover:bg-lime-950/60 p-5 px-8 rounded-lg">
                Back to wedding site
            </button>
        </footer>
    </div>
</template>
