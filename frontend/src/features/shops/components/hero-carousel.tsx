"use client";

import Image from "next/image";
import { memo, useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

const heroSlides = [
  {
    tagline: "FARM TO TABLE",
    title: "Fresh organic produce delivered in minutes",
    description:
      "Handpicked local vegetables, fresh fruits, and green organic produce sourced directly from nearby farm vendors. Quick, fresh, and supporting local merchants.",
    image: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1600&q=80",
    primaryCtaText: "Explore Fresh Greens",
    category: "vegetables",
    accentColor: "text-emerald-400",
    accentFill: "bg-emerald-400",
    stats: [
      { value: "100%", label: "Direct to Farmer" },
      { value: "10-20 min", label: "Delivery Time" },
      { value: "4.8", label: "Top Rated" }
    ]
  },
  {
    tagline: "NEIGHBORHOOD FAVORITES",
    title: "Your daily essentials close at hand",
    description:
      "Get milk, eggs, daily groceries, and pantry essentials delivered straight to your door from the grocery stores you trust. Fast, reliable, and convenient.",
    image: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1600&q=80",
    primaryCtaText: "Browse Daily Groceries",
    category: "grocery",
    accentColor: "text-amber-400",
    accentFill: "bg-amber-400",
    stats: [
      { value: "12+", label: "Local Stores" },
      { value: "Free", label: "Delivery Options" },
      { value: "A2 Grade", label: "Fresh Dairy" }
    ]
  },
  {
    tagline: "ARTISANAL BAKERY",
    title: "Warm crusty bakes from local ovens",
    description:
      "Freshly baked sourdough breads, flaky butter croissants, sweet pastries, and organic cookies from neighborhood bakeries. Delivered fresh from local ovens.",
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1600&q=80",
    primaryCtaText: "Order Warm Bakes",
    category: "bakery",
    accentColor: "text-rose-400",
    accentFill: "bg-rose-400",
    stats: [
      { value: "Artisan", label: "Handcrafted Bakes" },
      { value: "15-25 min", label: "Delivered Warm" },
      { value: "Fresh", label: "Baked Daily" }
    ]
  }
];

export const HeroCarousel = memo(function HeroCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % heroSlides.length);
    }, 6000);

    return () => window.clearInterval(interval);
  }, [isHovered]);

  const handleSlideCta = useCallback((category: string) => {
    window.dispatchEvent(new CustomEvent("lotzi:select-category", { detail: { category } }));
    document.getElementById("shops-section")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const goToPrevious = useCallback(() => {
    setActiveSlide((current) => (current - 1 + heroSlides.length) % heroSlides.length);
  }, []);

  const goToNext = useCallback(() => {
    setActiveSlide((current) => (current + 1) % heroSlides.length);
  }, []);

  return (
    <section className="hidden overflow-hidden px-3 py-6 sm:px-6 md:block lg:px-8">
      <div className="mx-auto w-full max-w-[1540px] rounded-[2rem] border border-slate-200 bg-white p-2 shadow-[0_28px_90px_rgb(15_23_42_/_0.14)]">
        <div
          className="group relative min-h-[580px] w-full overflow-hidden rounded-[1.65rem] bg-slate-950 text-white md:min-h-[580px] lg:min-h-[520px] xl:min-h-[480px]"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {heroSlides.map((slide, index) => (
            <div
              key={slide.title}
              className={`absolute inset-0 transition-all duration-[1200ms] ease-in-out ${
                index === activeSlide
                  ? "scale-100 opacity-100"
                  : "pointer-events-none scale-105 opacity-0"
              }`}
            >
              <Image
                src={slide.image}
                alt={slide.title}
                fill
                priority={index === 0}
                sizes="100vw"
                className="object-cover saturate-[0.6] contrast-[1.08] transition-transform duration-[6000ms] ease-out"
                style={{ transform: index === activeSlide && !isHovered ? "scale(1.04)" : "scale(1)" }}
              />
              <div className="absolute inset-0 bg-zinc-950/65" />
              <div className="absolute inset-0 bg-[linear-gradient(100deg,rgb(9_9_11_/_0.96)_0%,rgb(24_24_27_/_0.88)_48%,rgb(24_24_27_/_0.42)_100%)]" />
              <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-zinc-950/95 to-transparent" />
            </div>
          ))}

          <div className="relative z-10 flex min-h-[580px] w-full min-w-0 flex-col justify-center px-8 py-16 md:min-h-[580px] md:px-14 lg:min-h-[520px] lg:px-16 xl:min-h-[480px]">
            {heroSlides.map((slide, index) => (
              <div
                key={slide.title}
                className={`w-full transition-all duration-700 ease-in-out ${
                  index === activeSlide
                    ? "block translate-y-0 opacity-100"
                    : "hidden translate-y-4 opacity-0"
                }`}
              >
                <div className="max-w-4xl space-y-6">
                  <div className="inline-flex items-center gap-2 rounded-full border border-stone-200/20 bg-zinc-950/55 px-4 py-2 text-xs font-black tracking-[0.06em] text-stone-200 shadow-sm backdrop-blur-md">
                    <Sparkles size={13} className="text-amber-300" />
                    <span>{slide.tagline}</span>
                  </div>

                  <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                    {slide.title.split(" ").map((word, wordIndex, words) => {
                      const highlighted = wordIndex >= words.length - 2;
                      return (
                        <span
                          key={`${word}-${wordIndex}`}
                          className={highlighted ? `${slide.accentColor} inline-block` : "mr-3 inline-block text-white"}
                        >
                          {word}&nbsp;
                        </span>
                      );
                    })}
                  </h1>

                  <p className="max-w-2xl text-base leading-8 text-slate-200 sm:text-lg">
                    {slide.description}
                  </p>

                  <div className="flex flex-wrap gap-4 pt-2">
                    <button
                      type="button"
                      onClick={() => handleSlideCta(slide.category)}
                      className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-sm font-black text-zinc-950 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-white/10"
                    >
                      {slide.primaryCtaText}
                      <ArrowRight size={16} className="ml-2" />
                    </button>
                  </div>

                  <div className="mt-8 grid max-w-lg grid-cols-3 gap-6 border-t border-stone-200/10 pt-6">
                    {slide.stats.map((stat) => (
                      <div key={stat.label} className="space-y-1">
                        <p className={`text-xl font-extrabold ${slide.accentColor}`}>{stat.value}</p>
                        <p className="text-xs font-semibold text-stone-400">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={goToPrevious}
            className="absolute left-6 top-1/2 z-20 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-zinc-950/20 text-white opacity-0 shadow-lg backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:bg-white/15 active:scale-95 group-hover:opacity-100"
            aria-label="Previous slide"
          >
            <ChevronLeft size={22} />
          </button>

          <button
            type="button"
            onClick={goToNext}
            className="absolute right-6 top-1/2 z-20 flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-zinc-950/20 text-white opacity-0 shadow-lg backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:bg-white/15 active:scale-95 group-hover:opacity-100"
            aria-label="Next slide"
          >
            <ChevronRight size={22} />
          </button>

          <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2.5">
            {heroSlides.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                onClick={() => setActiveSlide(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === activeSlide ? `w-8 ${slide.accentFill}` : "w-2 bg-white/30 hover:bg-white/50"
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
});
