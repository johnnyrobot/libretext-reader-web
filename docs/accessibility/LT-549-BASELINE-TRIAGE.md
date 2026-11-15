# LT-549 baseline content triage

**Release HOLD. Static source triage of 94 catalog pages; no 1,488-page conformance claim.** Current reader source:185cbfe (executable-equivalent ef34231). No textbook source, alternative text or iframe content was edited. The companion inventory is `.scratch/lt549/closeout-185cbfe/baseline-triage.json`; locators are XPath-style indices within the exact named page.

## Confirmed source omissions and availability failures

These are directly verified markup/content facts. Their complete WCAG disposition still requires the stated context; a missing attribute is not being converted into a whole-page conformance verdict.

| Exact page | Locator | Confirmed fact | Feature impact and disposition |
|---|---|---|---|
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.E:_Solids_Liquids_and_Phase_Transitions_(Exercises)/index.html` | `(//img)[3]` | No src and no alt, title, ARIA name or decorative role. | This img has no renderable source. Whether an exercise illustration is missing or this is an empty/decorative placeholder is a source-owner decision; no invented alternative. |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.E:_Solids_Liquids_and_Phase_Transitions_(Exercises)/index.html` | `(//img)[5]` | No src and no alt, title, ARIA name or decorative role. | This img has no renderable source. Whether an exercise illustration is missing or this is an empty/decorative placeholder is a source-owner decision; no invented alternative. |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.E:_Chemical_Equilibrium_(Exercises)/index.html` | `(//img)[3]` | No src and no alt, title, ARIA name or decorative role. | This img has no renderable source. Whether an exercise illustration is missing or this is an empty/decorative placeholder is a source-owner decision; no invented alternative. |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.01:_Classifications_of_Acids_and_Bases/index.html` | `(//img)[16]` | JPEG has no alt, title, ARIA name or decorative role; surrounding figure caption exists. | Screen-reader image alternative absent; nearby caption describes electron flow/Lewis-acid carbon. Source owner must assess equivalence and supply or explicitly classify the image alternative. Listen image-alt behavior cannot recover absent authored alt. |
| `chem_4b/AGENDA1/index.html` | `(//iframe)[1]` | No title, ARIA name or decorative role on pronunciation iframe. | Three separate ADAPT exercises cannot be distinguished by authored frame names. Source/ADAPT owner must name embeds and assess live interaction/media; embedded content was not fetched or accepted by this offline inventory. |
| `chem_4b/AGENDA1/index.html` | `(//iframe)[2]` | No title, ARIA name or decorative role on pronunciation iframe. | Three separate ADAPT exercises cannot be distinguished by authored frame names. Source/ADAPT owner must name embeds and assess live interaction/media; embedded content was not fetched or accepted by this offline inventory. |
| `chem_4b/AGENDA1/index.html` | `(//iframe)[3]` | No title, ARIA name or decorative role on pronunciation iframe. | Three separate ADAPT exercises cannot be distinguished by authored frame names. Source/ADAPT owner must name embeds and assess live interaction/media; embedded content was not fetched or accepted by this offline inventory. |

Pronunciation source exercise IDs are `es-u1-l1-e1` (ala), `es-u1-l3-e7` (buenos días), and `es-u1-l3-e12` (mucho gusto), in iframe order1–3. The JPEG path is `/_assets/imported/e2/e2546ec40253a8d4223a9a7a186b18a0289cf0a7e5a7529944da48adc73dd2fb.jpg`.

## Confirmed Listen fallback; source-owner repair decision

On `chem_4b/Worksheets/10:_Weak_Acid_and_Base_Equilibria_(Worksheet)/index.html`, the generated speech manifest reports197spoken distinct formulas and2fallbacks. The two raw TeX inputs are `\(\ce{M(OH)_n\)` and `\(\ce[A^{–}]}\)`. Both map to **an equation**, not silence. The exact formula meaning is therefore unavailable in those Listen spans. Source owner must repair/confirm intended TeX and meaning, then reader pipeline/catalog validation must be repeated. This is retained source-content/fallback evidence, not a newly introduced annotation defect. MathJax/AT semantic correctness across the rest of the corpus remains untested. Details: `.scratch/lt549/closeout-185cbfe/math-fallbacks.json`.

## Source-owner decisions: generic thumbnails

All14entries use literal alt `mindtouch.page#thumbnail`. The link text is meaningful, so this is not automatically a failed link-purpose finding. Source owner must classify decorative/redundant thumbnails versus meaningful images; do not invent descriptions or silently replace source revisions.

| Exact page | Image locator | Adjacent/same-link text |
|---|---|---|
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/index.html` | `(//img)[3]` | I: Fundamentals of Thermochemistry (Heat and Enthalpy) |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/index.html` | `(//img)[4]` | II: Principles of Thermodynamics (Entropy and Gibbs Energy) |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/index.html` | `(//img)[3]` | III: Solids, Liquids, and Phase Transitions |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/index.html` | `(//img)[4]` | IV: Solutions |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/index.html` | `(//img)[3]` | V: Chemical Equilibrium |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/index.html` | `(//img)[4]` | VI: Acid–Base Equilibria |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/index.html` | `(//img)[5]` | VII: Solubility and Precipitation Equilibria |
| `chem_4b/Chem_4B_Textbook/index.html` | `(//img)[3]` | Unit I: Chemical Thermodynamics |
| `chem_4b/Chem_4B_Textbook/index.html` | `(//img)[4]` | Unit II: Physical Equilibria |
| `chem_4b/Chem_4B_Textbook/index.html` | `(//img)[5]` | Unit III: Chemical Equilibria |
| `chem_4b/index.html` | `(//img)[3]` | AGENDA |
| `chem_4b/index.html` | `(//img)[4]` | Chem 4B Textbook |
| `chem_4b/index.html` | `(//img)[5]` | Chem 4B Lab Manual |
| `chem_4b/index.html` | `(//img)[6]` | Worksheets |

## Untested semantic/content assessment: tables

153tables on the pages below need data-versus-layout classification, header/cell association, reading-order and AT assessment.14have no th and89have no caption; neither count alone proves failure because layout/decorative or surrounding-context alternatives have not been assessed. Companion JSON records each table index, role, caption, row/header counts and first-row text. Feature impact: discussion preserves the source table; Listen table summaries and baseline AT relationships still need representative actual-content checks.

| Exact page | Table indices | No-th indices |
|---|---|---|
| `chem_4b/AGENDA1/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4], (//table)[5], (//table)[6], (//table)[7], (//table)[8], (//table)[9], (//table)[10], (//table)[11], (//table)[12], (//table)[13], (//table)[14], (//table)[15], (//table)[16], (//table)[17], (//table)[18], (//table)[19], (//table)[20], (//table)[21], (//table)[22], (//table)[23], (//table)[24], (//table)[25], (//table)[26], (//table)[27], (//table)[28], (//table)[29] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.05:_Heat_Capacity_and_Calorimetry/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.06:_Molecules_as_Energy_Carriers_and_Converters/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.07:_Heats_of_Reactions_-_U_and_H/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.10:_Fuels_as_Sources_of_Energy/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/I:_Fundamentals_of_Thermochemistry_(Heat_and_Enthalpy)/1.E:_Fundamentals_of_Thermochemistry_(Exercises)/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/II:_Principles_of_Thermodynamics_(Entropy_and_Gibbs_Energy)/2.02:_Entropy_and_Spontaneity:_A_Molecular_Statistical_Interpretation/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/II:_Principles_of_Thermodynamics_(Entropy_and_Gibbs_Energy)/2.04:_Entropy_Changes_and_Spontaneity/index.html` | (//table)[1] | (//table)[1] |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/II:_Principles_of_Thermodynamics_(Entropy_and_Gibbs_Energy)/2.07:_The_Third_Law_of_Thermodynamics/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_I:_Chemical_Thermodynamics/II:_Principles_of_Thermodynamics_(Entropy_and_Gibbs_Energy)/2.08:_Gibbs_Energy/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.1:_Bulk_Properties_of_Gases_Liquids_and_Solids_-_Molecular_Interpretation/index.html` | (//table)[1], (//table)[2], (//table)[3] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.2:_Intermolecular_Forces_-_Origins_in_Molecular_Structure/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.4:_Phase_Equilibrium/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.5:_Phase_Transitions/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.6:_Phase_Diagrams/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/III:_Solids_Liquids_and_Phase_Transitions/3.8:_The_Solid_State/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.0:_Types_of_Solutions_-_Some_Terminology/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.1:_Composition_of_Solutions/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.2:_Nature_of_Dissolved_Species/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.3:_Phase_Equilibrium_in_Solutions_-_Nonvolatile_Solutes/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.4:_Phase_Equilibrium_in_Solutions_-_Volatile_Solutes/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.5:_Separating_Volatile_Solutions_-_Distillation/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_II:_Physical_Equilibria/IV:_Solutions/4.6:_Colloidal_Suspensions/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.2:_The_Empirical_Law_of_Mass_Action/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.3:_Thermodynamic_Description_of_the_Equilibrium_State/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.5:_Gas-Phase_and_Heterogeneous_Reaction_Equilibria/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4], (//table)[5], (//table)[6], (//table)[7], (//table)[8], (//table)[9], (//table)[10] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.6:_The_Direction_of_Change_in_Chemical_Reactions:_Empirical_Description/index.html` | (//table)[1], (//table)[2], (//table)[3] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.7:_The_Direction_of_Change_in_Chemical_Reactions_-_Thermodynamic_Explanation/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/V:_Chemical_Equilibrium/5.E:_Chemical_Equilibrium_(Exercises)/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4], (//table)[5], (//table)[6], (//table)[7], (//table)[8], (//table)[9], (//table)[10], (//table)[11], (//table)[12] | (//table)[1], (//table)[4], (//table)[6], (//table)[7], (//table)[8], (//table)[9], (//table)[10], (//table)[11], (//table)[12] |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.01:_Classifications_of_Acids_and_Bases/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.02:_The_Brnsted-Lowry_Scheme/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.03:_Acid_and_Base_Strength/index.html` | (//table)[1] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.04:_Equilibria_Involving_Weak_Acids_and_Bases/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.05:_Buffer_Solutions/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.06:_Acid-Base_Titration_Curves/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4], (//table)[5] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.07:_Polyprotic_Acids/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VI:_AcidBase_Equilibria/6.09:_Organic_Acids_and_Bases:_Structure_and_Reactivity/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4] | (//table)[2] |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VII:_Solubility_and_Precipitation_Equilibria/7.2:_Ionic_Equilibria_between_Solids_and_Solutions/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VII:_Solubility_and_Precipitation_Equilibria/7.3:_Precipitation_and_the_Solubility_Product/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4] | — |
| `chem_4b/Chem_4B_Textbook/Unit_III:_Chemical_Equilibria/VII:_Solubility_and_Precipitation_Equilibria/7.5:_Complex_Ions_and_Solubility/index.html` | (//table)[1], (//table)[2] | — |
| `chem_4b/Worksheets/02:_Thermochemistry_II_(Worksheet)/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4] | — |
| `chem_4b/Worksheets/03A:_Entropy_and_Probability_(Worksheet)/index.html` | (//table)[1] | — |
| `chem_4b/Worksheets/04:_Second_and_Third_Laws_of_Thermodynamics__(Worksheet)/index.html` | (//table)[1], (//table)[2], (//table)[3] | (//table)[3] |
| `chem_4b/Worksheets/05:_Intermolecular_Forces_and_Interactions/index.html` | (//table)[1] | — |
| `chem_4b/Worksheets/05B:_Solutions_and_Vapor_Pressures_(Worksheet)/index.html` | (//table)[1], (//table)[2] | (//table)[2] |
| `chem_4b/Worksheets/06:_Colligative_Properties_(Worksheet)/index.html` | (//table)[1] | — |
| `chem_4b/Worksheets/07:_Equilibria_Equilibrium_Constants_and_Acid-Bases_(Worksheet)/index.html` | (//table)[1], (//table)[2], (//table)[3] | — |
| `chem_4b/Worksheets/08:_ICE_Tables_(Worksheet)/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4] | — |
| `chem_4b/Worksheets/10:_Weak_Acid_and_Base_Equilibria_(Worksheet)/index.html` | (//table)[1], (//table)[2], (//table)[3], (//table)[4], (//table)[5], (//table)[6], (//table)[7], (//table)[8], (//table)[9], (//table)[10], (//table)[11] | (//table)[11] |
| `chem_4b/Worksheets/5C:_(Extra)_Intermolecular_Forces_(Worksheet)/index.html` | (//table)[1], (//table)[2] | — |

## Other finite unresolved gates

- Remaining warning contrast-incomplete nodes and cross-browser rendering need contextual visual evaluation; prior numeric samples do not resolve all incomplete states. See recorded warning/audit state targets.
- Source image equivalence, text-in-image, dynamic iframe media and full page/landmark/math/table reading remain untested beyond the recorded sample.
- Generic Sponsors ARIA advisory remains a contextual/source check; it is not automatically an introduced4.1.2failure. Decorative aria-hidden corner symbols remain a nontext contrast comparison, not normal-text contrast acceptance.
- Source-owner corrections require new source/catalog hashes and relevant speech/AT verification. Social Reading owns production1,488-page composition and source packaging; this94-page inventory is input, not production admission.
- Introduced-interface observation gaps are listed separately in LT-549-STATUS-OPERATOR-CHECK.md; no new annotation defect was established by this triage.
