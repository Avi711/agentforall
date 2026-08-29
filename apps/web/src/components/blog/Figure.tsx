import Image from "next/image";

const FRAME = "w-full rounded-[20px] border border-sand-light";

export function Figure({
  src,
  alt,
  caption,
  width = 1600,
  height = 900,
  mobile,
}: {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
  // Art direction: a taller crop for narrow screens, where a wide strip would shrink to illegible.
  mobile?: { src: string; width: number; height: number };
}) {
  return (
    <figure className="my-10">
      {mobile ? (
        <picture>
          <source media="(max-width: 640px)" srcSet={mobile.src} width={mobile.width} height={mobile.height} />
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot art-direct a <picture> */}
          <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className={FRAME} />
        </picture>
      ) : (
        <Image src={src} alt={alt} width={width} height={height} sizes="(max-width: 768px) 100vw, 768px" className={FRAME} />
      )}
      {caption ? <figcaption className="mt-3 text-center text-sm text-espresso-light">{caption}</figcaption> : null}
    </figure>
  );
}
