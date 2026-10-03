/** An empty or non-finite field must not silently become a coordinate of zero. */
export function geometryInputNumber(value: string): number {
  const number = Number(value);
  if (value.trim() === '' || !Number.isFinite(number))
    throw new Error('Enter a finite number in every geometry field.');
  return number;
}
