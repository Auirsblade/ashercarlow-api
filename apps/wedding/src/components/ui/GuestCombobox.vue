<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Check, ChevronsUpDown } from 'lucide-vue-next'
import { cn } from '@/lib'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import guestList from '@/assets/wedding_guest_list.json'

const router = useRouter()
const open = ref(false)
const selectedGuest = ref('')

const sortedGuests = computed(() =>
  [...guestList].sort((a, b) => a.name.localeCompare(b.name))
)

function onSelectGuest(guest) {
  selectedGuest.value = guest.name
  open.value = false
  router.push(`/invite/${encodeURIComponent(guest.name)}`)
}
</script>

<template>
  <div class="w-full max-w-sm mx-auto">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          variant="outline"
          role="combobox"
          :aria-expanded="open"
          class="w-full justify-between bg-lime-950/70 text-stone-200 hover:bg-lime-950/60 hover:text-stone-200 border-none h-auto py-4 px-6 text-xl"
        >
          <span v-if="selectedGuest">{{ selectedGuest }}</span>
          <span v-else>Find your name to RSVP</span>
          <ChevronsUpDown class="ml-2 h-5 w-5 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-[var(--reka-popover-trigger-width)] p-0" align="start">
        <Command class="bg-beige">
          <CommandInput placeholder="Search your name..." />
          <CommandList class="max-h-60">
            <CommandEmpty>Name not found. Please contact us.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                v-for="guest in sortedGuests"
                :key="guest.name"
                :value="guest.name"
                @select="onSelectGuest(guest)"
              >
                <Check
                  :class="cn(
                    'mr-2 h-4 w-4',
                    selectedGuest === guest.name ? 'opacity-100' : 'opacity-0'
                  )"
                />
                {{ guest.name }}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <div class="text-lg lg:text-xl mt-3 text-center">
      Please RSVP by March 31st 2026
    </div>
  </div>
</template>
