import { Controller, Get } from '@nestjs/common';

import { createOpenApiDocument } from './openapi.js';

@Controller('api/v1')
export class OpenApiController {
  @Get('openapi.json')
  public document() {
    return createOpenApiDocument();
  }
}
