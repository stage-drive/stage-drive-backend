import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AppService, HealthStatus } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOkResponse({ description: 'Сервер запущено, БД доступна' })
  @ApiServiceUnavailableResponse({ description: "Немає з'єднання з БД" })
  getHealth(): Promise<HealthStatus> {
    return this.appService.getHealth();
  }
}
