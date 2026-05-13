<template>
    <div>
        <header class="pt-8 sm:pt-14 pb-5 sm:pb-10 text-center">
            <h1 class="font-bold text-5xl sm:text-6xl text-slate-50 tracking-tight">
                Asher Carlow
            </h1>
            <div class="mt-3 mx-auto w-16 h-1 rounded-full bg-teal-400"></div>
            <p class="mt-4 text-lg text-slate-400">Senior Full Stack Developer</p>
            <p class="text-sm text-teal-400/80">Foundation Finance Company</p>

            <div class="flex justify-center gap-3 mt-3 sm:mt-6">
                <a href="mailto:me@ashercarlow.com"
                   class="inline-flex items-center gap-2 glass-card px-4 py-2 text-sm text-slate-400 hover:text-teal-400 hover:border-teal-400/30 transition-all duration-200">
                    <i class="pi pi-envelope"/>
                    <span>Email</span>
                </a>
                <a href="https://www.linkedin.com/in/asher-carlow/" target="_blank"
                   class="inline-flex items-center gap-2 glass-card px-4 py-2 text-sm text-slate-400 hover:text-teal-400 hover:border-teal-400/30 transition-all duration-200">
                    <i class="pi pi-linkedin"/>
                    <span>LinkedIn</span>
                </a>
                <a href="https://github.com/Auirsblade" target="_blank"
                   class="inline-flex items-center gap-2 glass-card px-4 py-2 text-sm text-slate-400 hover:text-teal-400 hover:border-teal-400/30 transition-all duration-200">
                    <i class="pi pi-github"/>
                    <span>GitHub</span>
                </a>
            </div>
        </header>

        <nav class="sticky top-0 z-10 py-2 sm:py-3 px-4 mb-5 sm:mb-10 flex justify-center">
            <div class="rounded-full px-1.5 sm:px-2 py-1.5 inline-flex gap-0.5 sm:gap-1 bg-white/[0.07] border border-white/[0.12] backdrop-blur-md">
                <a v-for="link in navLinks" :key="link.href"
                   :href="link.href"
                   class="px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm text-slate-400 hover:text-teal-400 hover:bg-white/5 transition-all duration-200">
                    {{ link.label }}
                </a>
            </div>
        </nav>

        <main class="space-y-14">
            <ExperienceSection :selectedTag="selectedTag" />
            <StackSection :selectedTag="selectedTag" @toggle="toggleTag" />
            <EducationSection />
        </main>
    </div>
</template>

<script setup lang="ts">
    import { ref } from 'vue'
    import "primeicons/primeicons.css"
    import EducationSection from "@/views/EducationSection.vue";
    import ExperienceSection from "@/views/ExperienceSection.vue";
    import StackSection from "@/views/StackSection.vue";

    const navLinks = [
        { href: '#experience', label: 'Experience' },
        { href: '#projects', label: 'Projects' },
        { href: '#stack', label: 'Stack' },
        { href: '#education', label: 'Education' },
    ]

    const selectedTag = ref<string | null>(null)

    function toggleTag(tag: string) {
        selectedTag.value = selectedTag.value === tag ? null : tag
    }
</script>

<style scoped>

</style>
