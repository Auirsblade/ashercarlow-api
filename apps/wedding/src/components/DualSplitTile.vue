<script setup>
defineProps({
    reverse: {
        type: Boolean,
        default: false
    }
})
</script>

<template>
    <div class="block lg:flex items-center justify-center my-8" :class="{ 'flex-row-reverse': reverse }">
        <div class="w-full lg:w-[40vw] mb-8 lg:mb-0">
            <div class="text-center text-5xl lg:text-left"
                 :class="reverse ? 'lg:float-left lg:ml-16' : 'lg:float-right lg:mr-16'">
                <slot name="title" class="text-5xl"></slot>
            </div>
        </div>
        <div class="mx-auto lg:mx-0 w-full lg:w-[2px] h-[2px] lg:h-auto lg:self-stretch bg-lime-950/20 my-8 lg:my-0"></div>
        <div class="w-full lg:w-[40vw]">
            <div class="text-center"
                 :class="reverse ? 'lg:float-right lg:mr-16' : 'lg:float-left lg:ml-16'">
                <slot name="content"></slot>
            </div>
        </div>
    </div>
</template>