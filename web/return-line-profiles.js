// Literal archived receipts. No model or network work is performed here.
export const PROFILES = [
  {
    "id": "record_1",
    "provenance": "archived-native-replay",
    "source_file": "threadwake/evidence/campaign/round13-coupled-bus/native-source.json",
    "source_sha256": "6c05e38be2816193ad90779d8aaceb0c667305a9823cff79becf3cc5fde6e32f",
    "source_label": "baseline",
    "request": {
      "relay": 0,
      "scope": "focused",
      "strength": 0,
      "bias": "BRIDGE",
      "request": "Restore the route. Preserve the archive.",
      "context": null
    },
    "worker_id": "8e8cedb630cd4a3fb321b048da603cf6",
    "model_revision": "2c3e507453b4f218d05fe3cc97bea5c5a654257e",
    "vector": {
      "BRIDGE": 0.022968843579292297,
      "SHELTER": 0.976659893989563,
      "SURGE": 0.00037125678500160575
    },
    "probabilities_before": {
      "BRIDGE": 0.022968843579292297,
      "SHELTER": 0.976659893989563,
      "SURGE": 0.00037125678500160575
    },
    "steering": {
      "applied": false,
      "method": "local action-logit gradient direction at final-layer residual",
      "target_action": "BRIDGE",
      "layer": 34,
      "scope": "focused",
      "strength": 0.0,
      "direction_sha256": null,
      "delta_l2": 0.0,
      "changed_elements": 0,
      "max_delta_abs": 0.0,
      "edited_tokens": 0
    }
  },
  {
    "id": "record_2",
    "provenance": "archived-native-replay",
    "source_file": "threadwake/evidence/campaign/round13-coupled-bus/native-source.json",
    "source_sha256": "6c05e38be2816193ad90779d8aaceb0c667305a9823cff79becf3cc5fde6e32f",
    "source_label": "focused-quarter",
    "request": {
      "relay": 0,
      "scope": "focused",
      "strength": 0.25,
      "bias": "BRIDGE",
      "request": "Restore the route. Preserve the archive.",
      "context": null
    },
    "worker_id": "94f070f4e1d74a7ab6ac9378aeaab467",
    "model_revision": "2c3e507453b4f218d05fe3cc97bea5c5a654257e",
    "vector": {
      "BRIDGE": 0.9999985694885254,
      "SHELTER": 1.3709570794162573e-06,
      "SURGE": 4.626834049495989e-22
    },
    "probabilities_before": {
      "BRIDGE": 0.022968843579292297,
      "SHELTER": 0.976659893989563,
      "SURGE": 0.00037125678500160575
    },
    "steering": {
      "applied": true,
      "method": "local action-logit gradient direction at final-layer residual",
      "target_action": "BRIDGE",
      "layer": 34,
      "scope": "focused",
      "strength": 0.25,
      "direction_sha256": "c4a2aaebd7750cd0be5582d9f521591a708520660403a15225176d94c8f6c293",
      "delta_l2": 4.331468105316162,
      "changed_elements": 1524,
      "max_delta_abs": 0.47113037109375,
      "edited_tokens": 1
    }
  },
  {
    "id": "record_3",
    "provenance": "archived-native-replay",
    "source_file": "threadwake/evidence/campaign/round13-coupled-bus/native-source.json",
    "source_sha256": "6c05e38be2816193ad90779d8aaceb0c667305a9823cff79becf3cc5fde6e32f",
    "source_label": "contact-candidate",
    "request": {
      "relay": 0,
      "scope": "focused",
      "strength": 0.03,
      "bias": "BRIDGE",
      "request": "Restore the route. Preserve the archive.",
      "context": null
    },
    "worker_id": "eb22c6e27b1b4169a3c0167229572c1d",
    "model_revision": "2c3e507453b4f218d05fe3cc97bea5c5a654257e",
    "vector": {
      "BRIDGE": 0.5312049388885498,
      "SHELTER": 0.46878671646118164,
      "SURGE": 8.334496669704095e-06
    },
    "probabilities_before": {
      "BRIDGE": 0.022968843579292297,
      "SHELTER": 0.976659893989563,
      "SURGE": 0.00037125678500160575
    },
    "steering": {
      "applied": true,
      "method": "local action-logit gradient direction at final-layer residual",
      "target_action": "BRIDGE",
      "layer": 34,
      "scope": "focused",
      "strength": 0.03,
      "direction_sha256": "c4a2aaebd7750cd0be5582d9f521591a708520660403a15225176d94c8f6c293",
      "delta_l2": 0.5199815630912781,
      "changed_elements": 1472,
      "max_delta_abs": 0.0567626953125,
      "edited_tokens": 1
    }
  }
];
