import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    findAll(): any[];
    create(body: any): {
        message: string;
        body: any;
    };
}
