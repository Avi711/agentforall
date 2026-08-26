import Image from "next/image";

export function Figure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="my-10">
      <Image
        src={src}
        alt={alt}
        width={1600}
        height={900}
        sizes="(max-width: 768px) 100vw, 768px"
        className="w-full rounded-[20px] border border-sand-light"
      />
      {caption ? <figcaption className="mt-3 text-center text-sm text-espresso-light">{caption}</figcaption> : null}
    </figure>
  );
}
