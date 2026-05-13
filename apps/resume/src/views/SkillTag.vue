<script setup lang="ts">
    import { Icon } from '@iconify/vue';

    defineProps({
        icon: { type: String, required: true },
        tag: String,
        selected: { type: Boolean, default: false },
        dimmed: { type: Boolean, default: false },
    })

    defineEmits(['click'])
</script>

<template>
    <div class="glass-card inline-flex items-center px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-all duration-200 cursor-pointer"
         :class="{
             'border-teal-400/50 shadow-md shadow-teal-400/15 text-teal-400': selected,
             'opacity-30': dimmed,
         }"
         :id="tag"
         @click="$emit('click')">
        <Icon :icon="icon" class="mr-2 text-base"/>{{ tag }}
    </div>
</template>
