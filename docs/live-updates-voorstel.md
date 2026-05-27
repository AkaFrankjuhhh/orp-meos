# Live updates

Status: uitgevoerd als eerste live-update laag.

## Wat nu gebouwd is

De website gebruikt Server-Sent Events via `/api/events`. De server stuurt nu gerichte update-events per onderdeel:

- `people:update` voor personeel, medewerkers, profielen, trainingen, badges, uren en sancties.
- `forms:update` voor I8, afwezigheid en ontslagformulieren.
- `porto:update` voor Porto status, OPS en eenheden.
- `public-forms:update` voor publieke formulierinstellingen en inzendingen.
- `state:update` blijft bestaan als fallback met een `scope` in de payload.

## Clientgedrag

De pManager-client bundelt updates kort en haalt daarna de nieuwste state op. Daarna rendert hij alleen het relevante deel opnieuw. De client pauzeert live refresh wanneer iemand actief werkt in:

- een input/select/textarea;
- een open dialog/pop-up;
- een rechtermuismenu;
- mentor-checklist notities.

De Porto-client pauzeert refresh tijdens OPS-indelen, koppelen, dropdowns, contextmenu's en andere actieve invoer.

## Waarom dit beter is

- Minder knipperen op pagina's.
- Minder kans dat invoer verdwijnt tijdens typen.
- OPS/Porto blijft live zonder menu's weg te drukken.
- Nieuwe wijzigingen komen alsnog automatisch binnen zodra de gebruiker klaar is met invoeren.

## Later nog mogelijk

Een volgende stap kan zijn om niet meer `/api/state` volledig op te halen, maar per scope kleine endpoints te maken zoals `/api/state/forms` of `/api/porto/live-state`. Dat verlaagt database- en netwerkbelasting nog verder, maar is voor de huidige grootte nog niet noodzakelijk.
