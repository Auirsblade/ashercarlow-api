<script setup lang="ts">
    import SkillTag from "@/views/SkillTag.vue";
    import { stackTags } from "@/data/stackTags";

    const props = defineProps<{
        selectedTag: string | null
    }>()

    const emit = defineEmits<{
        toggle: [tag: string]
    }>()
</script>

<template>
    <section id="stack">
        <div class="flex items-center gap-3 mb-6">
            <h2 class="font-bold text-2xl text-slate-50">Stack</h2>
            <div class="flex-1 h-px bg-teal-400/30"></div>
        </div>
        <div class="flex flex-wrap gap-2">
            <SkillTag
                v-for="st in stackTags"
                :key="st.tag"
                :icon="st.icon"
                :tag="st.tag"
                :selected="props.selectedTag === st.tag"
                :dimmed="props.selectedTag !== null && props.selectedTag !== st.tag"
                @click="emit('toggle', st.tag)"
            />
        </div>
    </section>
</template>
