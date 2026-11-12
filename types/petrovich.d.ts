declare module "petrovich" {
  type Case = "nominative" | "genitive" | "dative" | "accusative" | "instrumental" | "prepositional";
  interface Person { first?: string; middle?: string; last?: string; gender?: "male" | "female" | "androgynous" }
  const petrovich: { (person: Person, kase: Case): Person; detect_gender(middle: string): "male" | "female" | "androgynous" };
  export default petrovich;
}
