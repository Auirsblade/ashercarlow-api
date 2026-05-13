<script setup lang="ts">
    import { computed } from 'vue';
    import { Icon } from '@iconify/vue';
    import type { ExperienceData } from "@/types";
    import { stackTags } from "@/data/stackTags";

    const props = defineProps<{
        selectedTag: string | null
    }>()

    const tagIconMap = computed(() => {
        const map: Record<string, string> = {}
        for (const st of stackTags) {
            map[st.tag] = st.icon
        }
        return map
    })

    function isHighlighted(ed: ExperienceData): boolean {
        if (!props.selectedTag) return false
        return ed.tags?.includes(props.selectedTag) ?? false
    }

    function isDimmed(ed: ExperienceData): boolean {
        if (!props.selectedTag) return false
        return !(ed.tags?.includes(props.selectedTag) ?? false)
    }

    const experienceDatas: ExperienceData[] = [
        {
            employer: "Foundation Finance Company",
            location: "Stevens Point WI",
            timespan: "2026 - Present",
            tags: ["NestJS", "Kafka", "Docker", "MongoDB", "SQL Server"],
            positions: [
                {
                    title: "Senior Full Stack Developer",
                    points: [
                        "Maintaining and extending a suite of NestJS microservices on a small common services team, handling inter-application and external vendor API communication.",
                        "Building both REST and GraphQL APIs, with asynchronous inter-service communication via Kafka.",
                        "Working across SQL Server and MongoDB datastores depending on service requirements.",
                    ]
                },
            ]
        },
        {
            employer: "Sentry Insurance",
            location: "Stevens Point WI",
            timespan: "2022 - 2026",
            tags: ["C#", ".NET", "Java", "Vue.js", "Docker", "Jenkins", "MongoDB", "SQL Server"],
            positions: [
                {
                    title: "Senior Software Engineer",
                    points: [
                        "Led a team as Scrum master, implementing new planning methodologies to help the team deliver consistent results.",
                        "Moved to an experimental prototyping team focused on augmenting the capabilities of our underwriting team.",
                        "Worked in small short iterations to bring new ideas and solutions to the project shareholders.",
                        "Learned Java and converted the now more robust underwriting application from .NET to Java and spring framework.",
                        "Aided in onboarding a second team to assist with this project, putting in place various code quality, testing, and workflow standards."
                    ]
                },
                {
                    title: "Software Engineer",
                    points: [
                        "Spearheaded the modernization of service architectures for a large-scale application replacing a legacy system.",
                        "Optimized application performance through in-depth analysis and improvement of ORM code, leading to significantly faster page load times.",
                        "Designed and developed a modular front-end to facilitate future modifications as business needs evolve.",
                        "Facilitated seamless vendor communication by establishing a suite of robust API integrations using both SOAP and REST standards.",
                        "Empowered new team members by onboarding and training them, with a focus on fostering a curiosity and solution-focused culture.",
                        "Improved developer productivity by creating comprehensive documentation and helpful scripts to streamline daily tasks."
                    ]
                },
            ]
        },
        {
            employer: "Skyward Inc",
            location: "Stevens Point WI",
            timespan: "2019 - 2022",
            tags: ["C#", ".NET", "SQL Server"],
            positions: [
                {
                    title: "Software Engineer",
                    points: [
                        "Designed and implemented a real-time student information reporting API as part of a collaborative development team.",
                        "Developed a critical new process to report COVID-related student absences, facilitating the distribution of over $1 million in EBT funding. Designed for extensibility allowing for swift integration of new state-specific requirements.",
                        "Trained fellow developers on Git during the company's transition from Microsoft TFS.",
                        "Mentored interns and new developers on the Agile development process.",
                        "Led the rebuild of a student vaccination reporting API, significantly improving efficiency for large datasets and providing customers with enhanced data source transparency."
                    ]
                }
            ]
        },
    ]

    const hobbiestDatas: ExperienceData[] = [
        {
            employer: "Cashflow 2",
            timespan: "2025 - Current",
            tags: ["Vue.js", "C#", ".NET", "Docker"],
            positions: [
                {
                    title: "Developer",
                    points: [
                        "Solo project of mine that I'm working on as a web-based board game based on one my family enjoys. Fun opportunity to learn web-sockets and reactive design, while working with my brother and his Product Owner skills. See the link below for the prototype."
                    ]
                }
            ],
            link: "https://cf2.ashercarlow.com"
        },
        {
            employer: "Pulsarr Music",
            timespan: "2023 - Current",
            tags: ["Rust", "PostgreSQL", "Docker"],
            positions: [
                {
                    title: "Developer",
                    points: [
                        "A small passion project a few friends and I are collaborating on. I wanted to learn Rust, so our backend API is built in rust, using a Postgres db. Has been a good learning experience to learn a more functional language, as a departure from the .NET and Java I'm familiar with.",
                    ]
                }
            ],
            link: "https://pulsarr-music.com"
        },
        {
            employer: "Zora Consultants LLC",
            location: "Central Wisconsin",
            timespan: "2021 - Current",
            tags: ["C#", "Vue.js", "Docker", "PostgreSQL"],
            positions: [
                {
                    title: "Business Automation Consultant",
                    points: [
                        "Empowering local businesses by designing and implementing automated processes for weekly reports and streamlined record keeping. A friend of mine runs a business in town and explained their record keeping and the busywork it required to update employees on weekly tasks. I created an automated solution to save them time, and make coordination between employees easier as they expanded."
                    ]
                }
            ]
        },
    ]

</script>

<template>
    <section id="experience">
        <div class="flex items-center gap-3 mb-6">
            <h2 class="font-bold text-2xl text-slate-50">Experience</h2>
            <div class="flex-1 h-px bg-teal-400/30"></div>
        </div>
        <div class="space-y-4">
            <div v-for="(ed, i) in experienceDatas" :key="i">
                <div class="mb-2">
                    <div class="max-md:hidden text-slate-400 font-bold text-sm">{{ ed.employer }}, {{ ed.location }}{{ ed.location ? ', ' : ''}}{{ ed.timespan }}</div>
                    <div class="md:hidden">
                        <div class="text-slate-400 font-bold text-sm">{{ ed.employer }}</div>
                        <div class="text-slate-600 text-xs">{{ ed.location }}{{ ed.location ? ', ' : ''}}{{ ed.timespan }}</div>
                    </div>
                </div>
                <div class="glass-card px-4 py-3 transition-all duration-300"
                     :class="{
                         'border-teal-400/40 shadow-md shadow-teal-400/10': isHighlighted(ed),
                         'opacity-30': isDimmed(ed),
                     }">
                    <div v-for="(pos, j) in ed.positions" :key="j" class="mb-3 last:mb-0">
                        <strong class="font-bold text-lg text-slate-50">{{ pos.title }}</strong>
                        <ul class="list-disc list-outside pl-6 mt-1 text-slate-400 space-y-1">
                            <li v-for="(p, k) in pos.points" :key="k">
                                {{ p }}
                            </li>
                        </ul>
                    </div>
                    <div v-if="ed.tags?.length" class="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-slate-700/50">
                        <Icon v-for="t in ed.tags" :key="t"
                              :icon="tagIconMap[t]"
                              class="text-base text-slate-400 opacity-50"
                              :title="t" />
                    </div>
                </div>
            </div>
        </div>

        <div class="flex items-center gap-3 mt-12 mb-6" id="projects">
            <h2 class="font-bold text-2xl text-slate-50">Projects</h2>
            <div class="flex-1 h-px bg-teal-400/30"></div>
        </div>

        <!-- Bento Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div v-for="(ed, i) in hobbiestDatas" :key="i"
                 :class="{ 'sm:col-span-2': i === hobbiestDatas.length - 1 && hobbiestDatas.length % 2 !== 0 }"
                 class="glass-card px-4 py-4 transition-all duration-300"
                 :style="{ opacity: isDimmed(ed) ? 0.3 : 1 }">
                <div class="flex items-start justify-between mb-2">
                    <div>
                        <strong class="font-bold text-lg text-slate-50">{{ ed.employer }}</strong>
                        <div class="text-slate-600 text-xs">
                            {{ ed.location }}{{ ed.location ? ' · ' : '' }}{{ ed.timespan }}
                        </div>
                    </div>
                </div>
                <div v-for="(pos, j) in ed.positions" :key="j" class="mb-2 last:mb-0">
                    <div class="text-sm text-teal-400/70 mb-1">{{ pos.title }}</div>
                    <p class="text-slate-400 text-sm">
                        {{ pos.points[0] }}
                    </p>
                </div>
                <a v-if="ed.link" :href="ed.link" target="_blank"
                   class="inline-flex items-center gap-1 mt-2 text-sm text-teal-400 hover:text-teal-500 transition-colors duration-200">
                    View project <span class="text-xs">&#8594;</span>
                </a>
                <div v-if="ed.tags?.length" class="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-slate-700/50">
                    <Icon v-for="t in ed.tags" :key="t"
                          :icon="tagIconMap[t]"
                          class="text-base text-slate-400 opacity-50"
                          :title="t" />
                </div>
            </div>
        </div>
    </section>
</template>
