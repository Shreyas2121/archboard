import { Controller, Get } from '@nestjs/common';

const SERVICE_RESPONSE = Object.freeze({
  name: 'archboard-api',
  status: 'available',
});

@Controller()
export class AppController {
  @Get()
  getServiceInformation(): typeof SERVICE_RESPONSE {
    return SERVICE_RESPONSE;
  }
}
