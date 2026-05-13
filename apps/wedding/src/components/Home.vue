<script setup lang="ts">
import DualSplitTile from "@/components/DualSplitTile.vue";
import Countdown from "@/components/Countdown.vue";
import GuestCombobox from "@/components/ui/GuestCombobox.vue";
import {ref} from "vue";

const activeHotel = ref('')
const activeFaqIndex = ref(-1) // -1 means no FAQ is active

const galleryImages = [
    'IMG_4412.jpeg',
    'PaulinaandAsher-098.JPG',
    'IMG_3280.jpeg',
    'PaulinaandAsher-152.JPG',
    '201E8497-EEAB-4430-A70B-D24D41DBF32C.JPG',
    'PaulinaandAsher-163.JPG',
    'IMG_1243.JPG',
    'IMG_3710.jpeg',
    'IMG_3834.jpeg',
    'IMG_9224.jpeg',
    'IMG_0757.JPG',
    'IMG_1544.jpeg',
    'IMG_0654.jpeg',
    'IMG_6371.jpeg',
    'IMG_7576.jpeg',
    'IMG_0235.jpeg',
    'IMG_0412.JPG',
    'IMG_1968.JPG',
    'PaulinaandAsher-080.JPG',
    'IMG_3222.jpg',
    'IMG_3980.jpeg',
    'PaulinaandAsher-134.JPG',
    'IMG_0139.jpeg',
    'IMG_3350.jpeg'
]

const faqs = [
    {
        question: "Is there parking at the venue?",
        answer: "Shared lot space and street parking is available at the venue. Please be aware that parking is limited, so carpooling to / from the venue is encouraged."
    },
    {
        question: "Is there transportation to and from the venue?",
        answer: "Unfortunately shuttles are not available from the hotels."
    },
    {
        question: "Can I bring a plus one?",
        answer: "Please refer to your invitation."
    },
    {
        question: "Are children welcome?",
        answer: "While the wedding celebration will be geared towards adults, we completely understand if it works best for your family to bring them along - they're welcome too!"
    },
    {
        question: "Will the ceremony and reception be indoors or outdoors?",
        answer: "The ceremony will be held outdoors at Mercantile Hall if weather permits. The remainder of the celebration will be held in both their indoor and outdoor spaces."
    },
    {
        question: "Will there be a cash bar?",
        answer: "Drinks are on us! Both alcoholic and non-alcoholic beverages will be available throughout the celebration."
    },
    {
        question: "What's for dinner?",
        answer: "Our dinner will be a self-serve selection of mexican dishes including quesadillas, taco bowls, street corn, and more!"
    },
    {
        question: "Can I take photos?",
        answer: "Of course! And we'd love it if you share some of the photos you take throughout the night with us after the event!"
    }
]
</script>

<template>
    <div class="bg-beige text-lime-950 min-h-svh text-2xl font-serif" style="--nav-height: 72px;">
        <div class="text-center">
            <div class="bg-[url('/PaulinaAsher.jpg')] bg-cover bg-[top_24%_left] bg-no-repeat min-h-[720px] lg:h-[720px] flex flex-col">
                <header class="pb-18 bg-gradient-to-b from-beige to-transparent to-100%">
                    <div class="text-4xl lg:text-4xl lg:text-5xl pt-5">Wedding of Paulina Twerberg & Asher Carlow</div>
                    <div class="text-3xl lg:text-4xl">May 31st 2026 | Mercantile Hall</div>
                </header>
                <div class="mt-auto px-5 pt-44 bg-gradient-to-b from-transparent to-beige to-100%">
                    <div class="lg:hidden pb-5"><!-- Spacer for mobile --></div>
                    After almost 10 years, our big day is nearly here! We can't wait to say "I do" surrounded by our
                    favorite people who've been part of our story all along. Having you with us will make our special day
                    that much sweeter. Love, Paulina and Asher
                </div>
            </div>
        </div>

        <!-- Navigation with decorative separators -->
        <nav class="sticky top-0 bg-beige/95 backdrop-blur-sm py-4 px-4 z-50 border-b border-lime-950/10">
            <div class="flex flex-wrap justify-center gap-4 lg:gap-6 text-lg lg:text-xl">
                <a class="hover:text-lime-700 transition-colors" href="#venue">Venue</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#wedding-party">Wedding Party</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#schedule">Schedule</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#attire">Attire</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#rsvp">RSVP</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#lodging">Lodging</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#registry">Registry</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#faq">FAQ</a>
                <span class="text-lime-950/30 hidden lg:inline">✦</span>
                <a class="hover:text-lime-700 transition-colors" href="#gallery">Gallery</a>
            </div>
        </nav>

        <main class="px-4">
            <div class="text-center">
                <DualSplitTile id="venue" class="section-anchor">
                    <template #title>
                        <div class="text-4xl lg:text-5xl">Venue</div>
                    </template>
                    <template #content>
                        <img alt="Mercantile Hall Logo" class="mx-auto h-16" src="/MH.png"/>
                        <a class="hover:text-lime-700 transition-colors underline"
                           href="https://maps.google.com/maps?q=mercantile%20hall%2C%20burlington%2C%20wi"
                           rel="noopener noreferrer"
                           target="_blank">
                            <span class="block mt-3">Mercantile Hall</span>
                            <div>425 N. Pine Street</div>
                            <div>Burlington, WI 53105</div>
                        </a>
                    </template>
                </DualSplitTile>

                <div id="wedding-party" class="block lg:flex items-center justify-center mb-16 section-anchor">

                    <!-- Wedding Party Title Section -->
                    <div class="w-full lg:w-[30vw] mb-8 lg:mb-0 lg:order-3">
                        <div class="text-center text-4xl lg:text-5xl lg:mx-auto">
                            Wedding Party
                            <!-- Decorative flourish under title -->
                            <div class="flex items-center text-2xl justify-center gap-2 my-4 text-lime-950/30">
                                <span>──────</span><span>✦</span><span>──────</span>
                            </div>
                            <strong class="block text-2xl mt-4">Officiant</strong>
                            <div class="text-2xl">Kristoffer Twerberg</div>
                        </div>
                    </div>

                    <!-- First Divider -->
                    <div class="mx-auto lg:mx-0 w-full lg:w-[2px] h-[2px] lg:h-auto lg:self-stretch bg-lime-950/20 my-8 lg:my-0 lg:order-2"></div>

                    <!-- Maid of Honor Section -->
                    <div class="w-full lg:w-[30vw] mb-8 lg:mb-0 lg:order-1">
                        <div class="lg:float-right lg:mr-16">
                            <strong class="block text-2xl mb-2">Maid of Honor</strong>
                            <div class="mb-3">Lauren Zaitz</div>
                            <strong class="block text-2xl mb-2">Bridesmaids</strong>
                            <div class="space-y-1">
                                <div>Ella Leipzig</div>
                                <div>Brooke Gumataotao</div>
                                <div>Natasha Barnett</div>
                                <div>Madeline Check</div>
                            </div>
                        </div>
                    </div>

                    <!-- Second Divider -->
                    <div class="mx-auto lg:mx-0 w-full lg:w-[2px] h-[2px] lg:h-auto lg:self-stretch bg-lime-950/20 my-8 lg:my-0 lg:order-4"></div>

                    <!-- Best Man Section -->
                    <div class="w-full lg:w-[30vw] lg:order-5">
                        <div class="lg:float-left lg:ml-16">
                            <strong class="block text-2xl mb-2">Best Man</strong>
                            <div class="mb-3">Ethan Hart</div>
                            <strong class="block text-2xl mb-2">Groomsmen</strong>
                            <div class="space-y-1">
                                <div>Jude Hoogendyk</div>
                                <div>Mason Carlow</div>
                                <div>Addison Sedivy</div>
                                <div>Noah Hess</div>
                            </div>
                        </div>
                    </div>
                </div>

                <DualSplitTile id="schedule" bar-height="64" class="section-anchor" reverse>
                    <template #title>
                        <div class="text-4xl lg:text-5xl">Schedule</div>
                    </template>
                    <template #content>
                        <div class="grid grid-cols-2 gap-2">
                            <strong class="block text-2xl mr-2">Arrival</strong>
                            <div>3:30 pm</div>
                            <hr class="col-span-2"/>
                            <strong class="block text-2xl mr-2">Ceremony</strong>
                            <div>4 pm</div>
                            <hr class="col-span-2"/>
                            <strong class="block text-2xl mr-2">Cocktail Hour</strong>
                            <div>4:30 pm</div>
                            <hr class="col-span-2"/>
                            <strong class="block text-2xl mr-2">Dinner</strong>
                            <div>6 pm</div>
                            <hr class="col-span-2"/>
                            <strong class="block text-2xl mr-2">First Dance</strong>
                            <div>7:30 pm</div>
                            <hr class="col-span-2"/>
                            <strong class="block text-2xl mr-2">Last Call</strong>
                            <div>11:30 pm</div>
                        </div>
                    </template>
                </DualSplitTile>

                <DualSplitTile id="attire" class="section-anchor">
                    <template #content>
                        <div class="lg:w-96">
                            <strong class="text-2xl mb-2">Semi-formal</strong>
                            <div class="space-y-3">
                                <div>Please refrain from wearing beige or green to avoid matching the wedding party
                                </div>
                                <div>... and of course, white!</div>
                            </div>
                        </div>
                    </template>
                    <template #title>
                        <div class="text-4xl lg:text-5xl">Attire</div>
                    </template>
                </DualSplitTile>

                <DualSplitTile id="rsvp" class="section-anchor" reverse>
                    <template #content>
                        <GuestCombobox />
                    </template>
                    <template #title>
                        <div class="text-4xl lg:text-5xl">RSVP</div>
                    </template>
                </DualSplitTile>

                <DualSplitTile id="lodging" class="section-anchor">
                    <template #title>
                        <div class="text-4xl lg:text-5xl">Lodging</div>
                    </template>
                    <template #content>
                        <div class="space-y-4 lg:w-[40vw]">
                            <!-- Hampton Inn -->
                            <div class="border border-lime-950/20 rounded-lg overflow-hidden">
                                <button
                                    class="w-full p-4 text-left flex justify-between items-center hover:bg-lime-950/5"
                                    @click="activeHotel = activeHotel === 'hampton' ? '' : 'hampton'">
                                    <span class="text-2xl">Hampton Inn</span>
                                    <span :class="{ 'rotate-180': activeHotel === 'hampton' }"
                                          class="transform transition-transform">▼</span>
                                </button>
                                <div v-if="activeHotel === 'hampton'" class="p-2 border-t border-lime-950/20">
                                    <div class="space-y-3">
                                        <p>400 N. Dodge St., Burlington, WI 53105</p>
                                        <p class="text-lg lg:text-xl">(1 block from venue)</p>
                                        <p><strong>Group Name:</strong> Twerberg-Carlow Wedding Block</p>
                                        <p><strong>Group Code:</strong> TWE</p>
                                        <p><strong>Cutoff Date:</strong> May 1st, 2026</p>
                                        <div class="mt-4">
                                            <strong class="block mb-2">Booking Instructions:</strong>
                                            <p class="pl-5 space-y-1">
                                                Call front desk 262-767-1900 or go to
                                                <a class="underline" href="https://hampton.com" target="_blank">hampton.com</a>
                                                and enter the Group Code under Special Rates
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Fairfield by Marriott -->
                            <div class="border border-lime-950/20 rounded-lg overflow-hidden">
                                <button
                                    class="w-full p-4 text-left flex justify-between items-center hover:bg-lime-950/5"
                                    @click="activeHotel = activeHotel === 'fairfield' ? '' : 'fairfield'">
                                    <span class="text-2xl">Fairfield by Marriott</span>
                                    <span :class="{ 'rotate-180': activeHotel === 'fairfield' }"
                                          class="transform transition-transform">▼</span>
                                </button>
                                <div v-if="activeHotel === 'fairfield'" class="p-4 border-t border-lime-950/20">
                                    <div class="space-y-3">
                                        <p>1111 North Edwards Boulevard, Lake Geneva WI 53147</p>
                                        <p class="text-lg lg:text-xl">(10mi from venue)</p>
                                        <p><strong>Group Name:</strong> Twerberg-Carlow Wedding</p>
                                        <p><strong>Cutoff Date:</strong> April 30, 2026</p>
                                        <div class="mt-4">
                                            <strong class="block mb-2">Booking Instructions:</strong>
                                            <p>Call front desk: 262-348-9000</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Comfort Suites -->
                            <div class="border border-lime-950/20 rounded-lg overflow-hidden">
                                <button
                                    class="w-full p-4 text-left flex justify-between items-center hover:bg-lime-950/5"
                                    @click="activeHotel = activeHotel === 'comfort' ? '' : 'comfort'">
                                    <span class="text-2xl">Comfort Suites, Lake Geneva</span>
                                    <span :class="{ 'rotate-180': activeHotel === 'comfort' }"
                                          class="transform transition-transform">▼</span>
                                </button>
                                <div v-if="activeHotel === 'comfort'" class="p-4 border-t border-lime-950/20">
                                    <div class="space-y-3">
                                        <p>300 East Main Street, Lake Geneva, WI 53147</p>
                                        <p class="text-lg lg:text-xl">(13mi from venue)</p>
                                        <p><strong>Group Name:</strong> Twerberg-Carlow Wedding</p>
                                        <p><strong>Cutoff Date:</strong> April 21st, 2026</p>
                                        <div class="mt-4">
                                            <strong class="block mb-2">Booking Instructions:</strong>
                                            <p>Call the property directly at 262-248-2300 or</p>
                                            <a class="text-lime-700 hover:underline"
                                               href="https://www.choicehotels.com/reservations/groups/PK11E8"
                                               rel="noopener noreferrer"
                                               target="_blank">
                                                Book Online
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>
                </DualSplitTile>

                <DualSplitTile id="registry" class="section-anchor" reverse>
                    <template #title>Registry</template>
                    <template #content>
                        <a href="https://www.myregistry.com/wedding-registry/asher-carlow-and-paulina-twerberg-/5068784"
                           target="_blank">
                            <div
                                class="bg-lime-950/70 text-stone-200 hover:bg-lime-950/60 p-6 text-center max-w-fit m-auto rounded-lg">
                                <div>Registry</div>
                            </div>
                        </a>
                        <div class="text-md lg:text-lg">(Gifts not required or expected. We're actively working on the registry, so check back later - though we likely will be focusing on small items/gift cards as we'll be moving shortly after the wedding)</div>
                    </template>
                </DualSplitTile>

                <DualSplitTile id="faq" class="section-anchor">
                    <template #title>
                        <div class="text-4xl lg:text-5xl">FAQ</div>
                    </template>
                    <template #content>
                        <div class="space-y-4 lg:w-[40vw]">
                            <div v-for="(faq, index) in faqs" :key="index"
                                 class="border border-lime-950/20 rounded-lg overflow-hidden">
                                <button
                                    class="w-full p-4 text-left flex justify-between items-center hover:bg-lime-950/5"
                                    @click="activeFaqIndex = activeFaqIndex === index ? -1 : index">
                                    <span class="text-2xl">{{ faq.question }}</span>
                                    <span :class="{ 'rotate-180': activeFaqIndex === index }"
                                          class="transform transition-transform">▼</span>
                                </button>
                                <div v-if="activeFaqIndex === index" class="p-4 border-t border-lime-950/20">
                                    <p>{{ faq.answer }}</p>
                                </div>
                            </div>
                        </div>
                    </template>
                </DualSplitTile>

                <div id="gallery" class="section-anchor mb-16">
                    <div class="text-4xl lg:text-5xl">Gallery</div>
                    <!-- Decorative flourish -->
                    <div class="flex items-center justify-center gap-2 my-6 text-lime-950/30">
                        <span>─────</span><span>✦</span><span>─────</span>
                    </div>
                    <div class="columns-2 md:columns-3 lg:columns-4 gap-4">
                        <img
                            v-for="image in galleryImages"
                            :key="image"
                            :src="`/gallery/${image}`"
                            :alt="image"
                            class="w-full mb-4 rounded-lg hover:opacity-90 transition-opacity"
                        />
                    </div>
                </div>

                <Countdown/>
            </div>
        </main>
    </div>
</template>

<style scoped>
.section-anchor {
    scroll-margin-top: 8rem; /* 128px for mobile */
}

@media (min-width: 1024px) {
    .section-anchor {
        scroll-margin-top: 4rem; /* 32px for desktop */
    }
}
</style>
