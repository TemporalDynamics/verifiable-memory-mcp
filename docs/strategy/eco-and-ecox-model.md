# ECO and ECOX Model

ECO is the portable evidence artifact. It is the forensic receipt.

ECO captures key events, status, authority, ledger summaries, assets, hashes, and verification data. It is designed to be shared and verified independently. Public copy should call the underlying data the **Evidence Record** and its SHA-256 the **Evidence Hash**; `bundle` remains an internal compatibility term.

ECOX is the extended forensic evidence package. It is the forensic replay.

ECOX may include deeper traces, raw sources, intermediate versions, edit process, discarded material, and other sensitive context. ECOX is permissioned by default and belongs in advanced or enterprise contexts.

The public sandbox can generate a sanitized `.ecox` replay package for each browser run. That sandbox ECOX includes the generated ECO, visible run state, verifier hints, and a redaction policy; it intentionally omits browser/device data, credentials, private modules, and implementation internals. The sandbox also supports strict verification by downloading the Evidence Record separately from the ECO receipt and comparing the Evidence Hash.

Public tools verify integrity. Permissioned products interpret deeper evidence.
