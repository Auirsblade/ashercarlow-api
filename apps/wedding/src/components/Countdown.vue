<script lang="ts" setup>

import {onMounted, onUnmounted, ref} from 'vue'

const weddingDate = new Date(Date.UTC(2026, 4, 31, 21, 0, 0))
const days = ref(0)
const hours = ref(0)
const minutes = ref(0)
let timer

const updateCountdown = () => {
    const now = new Date()
    const diff = weddingDate - now

    if (diff > 0) {
        days.value = Math.floor(diff / (1000 * 60 * 60 * 24))
        hours.value = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        minutes.value = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    }
}

onMounted(() => {
    updateCountdown()
    // Update every minute
    timer = setInterval(updateCountdown, 60000)
})

onUnmounted(() => {
    if (timer) clearInterval(timer)
})
</script>

<template>
    <div class="max-w-64 mx-auto text-center pb-4">
        <div class="grid grid-cols-3 gap-1">
            <div class="flex flex-col items-center">
                <span class="text-3xl font-semibold">{{ days }}</span>
                <span class="text-sm">Days</span>
            </div>
            <div class="flex flex-col items-center">
                <span class="text-3xl font-semibold">{{ hours }}</span>
                <span class="text-sm">Hours</span>
            </div>
            <div class="flex flex-col items-center">
                <span class="text-3xl font-semibold">{{ minutes }}</span>
                <span class="text-sm">Minutes</span>
            </div>
        </div>
    </div>
</template>

<style scoped>

</style>