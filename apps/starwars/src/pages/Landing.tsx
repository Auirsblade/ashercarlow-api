import type { Component } from "solid-js";
import { A } from "@solidjs/router";
import { ArrowRight } from "lucide-solid";

const Landing: Component = () => {
  return (
    <main class="min-h-screen w-full flex items-center justify-center px-6">
      <div class="max-w-2xl text-center space-y-8">
        <p class="text-xs uppercase tracking-[0.4em] text-amber-400/80">
          ashercarlow · star wars
        </p>
        <h1 class="text-5xl md:text-6xl font-bold text-zinc-50 leading-tight">
          A personal field guide to <span class="text-amber-300">Star Wars</span>.
        </h1>
        <p class="text-lg text-zinc-400 leading-relaxed">
          Episode-by-episode watch trackers and classification systems for the
          shows worth re-watching in the right order. More guides will land here
          as I get to them.
        </p>
        <div class="pt-4">
          <A
            href="/tcw"
            class="inline-flex items-center gap-2 rounded-xl bg-amber-300 px-6 py-3 text-base font-semibold text-zinc-950 transition hover:bg-amber-200"
          >
            The Clone Wars watch guide
            <ArrowRight size={18} />
          </A>
        </div>
      </div>
    </main>
  );
};

export default Landing;
