import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Figure } from "@/components/blog/Figure";
import { Platform, PlatformPicker } from "@/components/blog/PlatformGuide";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: (props) => <h2 className="font-display mt-12 text-2xl text-espresso sm:text-3xl" {...props} />,
    h3: (props) => <h3 className="mt-8 text-lg font-bold text-espresso sm:text-xl" {...props} />,
    p: (props) => <p className="mt-5 text-base leading-[1.85] text-espresso-light sm:text-[17px]" {...props} />,
    ul: (props) => <ul className="mt-5 list-disc space-y-2 pe-6 leading-relaxed text-espresso-light" {...props} />,
    ol: (props) => <ol className="mt-5 list-decimal space-y-2 pe-6 leading-relaxed text-espresso-light" {...props} />,
    li: (props) => <li className="ps-1" {...props} />,
    strong: (props) => <strong className="font-bold text-espresso" {...props} />,
    blockquote: (props) => (
      <blockquote className="mt-6 border-e-4 border-terra bg-terra-pale/60 px-5 py-4 text-espresso" {...props} />
    ),
    a: ({ href = "", ...props }) =>
      href.startsWith("/") ? (
        <Link href={href} className="font-semibold text-terra hover:underline" {...props} />
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-terra hover:underline" {...props} />
      ),
    hr: () => <hr className="my-10 border-sand-light" />,
    Figure,
    Platform,
    PlatformPicker,
    ...components,
  };
}
