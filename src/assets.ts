/**
 * Asset manifest. Agent Wall draws its board and cards on canvases at runtime,
 * so there are no loaded assets yet. Must stay side-effect free (the IWSDK
 * editor evaluates this module in a second realm).
 */
import { defineAssets } from '@iwsdk/core';

export default defineAssets({});
