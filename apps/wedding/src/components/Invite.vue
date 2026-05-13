<script setup>
    import {ref, onMounted} from 'vue'
    import {useRouter} from 'vue-router'
    import guestList from '../assets/wedding_guest_list.json'

    const router = useRouter()
    const props = defineProps({
        name: String
    })

    const guest = ref(null)

    onMounted(() => {
        guest.value = guestList.find(g =>
            g.name.toLowerCase() === decodeURIComponent(props.name).toLowerCase()
        )
    })

    const goHome = () => {
        router.push('/')
    }
</script>

<template>
    <div class="bg-beige text-lime-950 min-h-svh font-serif">
        <div v-if="guest" class="min-h-svh lg:flex">
            <!-- Image Section -->
            <div class="image-section h-screen lg:h-auto lg:w-1/2 relative overflow-hidden">
                <div class="absolute inset-0 bg-cover bg-[center_75%] lg:bg-center" style="background-image: url('/Hooray.jpg')"></div>
                <!-- Mobile gradient (bottom to top) -->
                <div class="absolute inset-0 bg-gradient-to-t from-beige via-transparent to-transparent lg:hidden"></div>
                <!-- Desktop gradient (right edge) -->
                <div class="hidden lg:block absolute inset-0 bg-gradient-to-r from-transparent from-[87.5%] to-beige"></div>
            </div>

            <!-- Content Section -->
            <div class="lg:w-1/2 p-12 relative z-10 flex items-center">
                <div class="max-w-xl mx-auto">
                    <h1 class="text-4xl lg:text-5xl mb-8">Welcome, {{ guest.name }}!</h1>

                    <div class="bg-beige/50 rounded-lg shadow-lg p-8 mb-8 text-2xl space-y-6">
                        <p>
                            We're delighted to have you join us for our special day! </p>
                        <div>
                            <p v-if="guest.plus_one" class="text-lime-700">
                                ✓ You are welcome to bring a plus one! </p>
                            <p v-else-if="guest.kids > 0" class="text-lime-700">
                                ✓ Your {{ guest.kids }} {{ guest.kids === 1 ? 'child is' : 'children are' }} included in this invitation. (See FAQ for details) </p>
                            <p v-else class="text-lime-950/70">
                                This invitation is for you personally. </p>
                        </div>

                        <div></div>

                        <div class="pt-4 space-y-4">
                            <a href="https://forms.gle/yfvmBGVVCJv1H2AN7" target="_blank"
                               class="block bg-lime-950/70 text-stone-200 hover:bg-lime-950/60 p-6 text-center max-w-fit mx-auto rounded-lg">
                                <div>Click here to RSVP</div>
                                <div class="text-lg lg:text-xl">Please RSVP by March 31st 2026</div>
                            </a>

                            <button @click="goHome"
                                    class="block bg-lime-950/70 text-stone-200 hover:bg-lime-950/60 p-6 text-center max-w-fit mx-auto rounded-lg w-full">
                                <div>Return to Main Page</div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Error State -->
        <div v-else class="container mx-auto px-4 py-12 text-center">
            <div class="max-w-2xl mx-auto">
                <p class="text-2xl text-red-600 mb-6">
                    Sorry, we couldn't find your invitation. Please check the URL or contact us for assistance. </p>
                <button @click="goHome" class="bg-lime-950/70 text-stone-200 hover:bg-lime-950/60 p-6 text-center mx-auto rounded-lg">
                    <div>Return to Main Page</div>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .image-section {
        min-height: 100vh;
    }

    @media (min-width: 1024px) {
        .image-section {
            min-height: unset;
        }
    }
</style>