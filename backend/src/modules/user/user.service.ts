import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UpdateUserDto } from './dto/update_user.dto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UpdatePasswordDto } from './dto/update_password.dto';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as nodemailer from 'nodemailer';
import { PhoneOtpService } from '../otp/otp.service';
import { OtpContext } from '@prisma/client';
import { parseUserAgent } from '../auth/auth.service';
import { ActivityLogService } from './activity_log.service';
import { validateAndReencodeImage } from '../../common/uploads/upload.util';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private phoneOtpService: PhoneOtpService,
    private activityLogService: ActivityLogService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        address: true,
        role: true,
        image: true,
        isActive: true,
        twoFactorEnabled: true,
        createdAt: true,
        vendorProfile: true,
        doctorProfile: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
  }

  async findOrCreateOAuthUser(data: {
    email: string;
    name: string;
    image?: string;
    role?: string;
    userAgent?: string;
    ipAddress?: string;
    provider?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    const isNewProviderLink =
      !!existing &&
      existing.lastOAuthProvider &&
      existing.lastOAuthProvider !== data.provider;

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { lastOAuthProvider: data.provider },
          select: {
            id: true,
            email: true,
            role: true,
            phone: true,
            phoneVerifiedAt: true,
            address: true,
            image: true,
            name: true,
            twoFactorEnabled: true,
          },
        })
      : await this.prisma.user.create({
          data: {
            email: data.email,
            name: data.name,
            image: data.image,
            role: data.role === 'VENDOR' ? 'VENDOR' : 'USER',
            isActive: true,
            lastOAuthProvider: data.provider,
            ...(data.role === 'VENDOR' && {
              vendorProfile: {
                create: {
                  businessName: data.name ?? '',
                  businessType: 'INDIVIDUAL',
                },
              },
            }),
          },
          select: {
            id: true,
            email: true,
            role: true,
            phone: true,
            phoneVerifiedAt: true,
            address: true,
            image: true,
            name: true,
            twoFactorEnabled: true,
          },
        });

    if (isNewProviderLink) {
      await this.activityLogService.log(user.id, 'OAUTH_PROVIDER_LINKED', {
        ipAddress: data.ipAddress,
        deviceLabel: parseUserAgent(data.userAgent),
        description: `Signed in with ${data.provider} (previously used a different method)`,
      });
      this.notifyNewProviderLinked(data.email, data.provider!).catch(() => {});
    }

    if (user.twoFactorEnabled) {
      if (!user.phone || !user.phoneVerifiedAt) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { twoFactorEnabled: false },
        });
        await this.activityLogService.log(user.id, 'TWO_FA_DISABLED', {
          description:
            'Auto-disabled: no verified phone on file at login time.',
        });
      } else {
        await this.phoneOtpService.sendOtp(user.phone, OtpContext.LOGIN);
        const tempToken = this.jwtService.sign(
          { sub: user.id, purpose: 'login_2fa' },
          { expiresIn: '5m' },
        );
        return { requiresTwoFactor: true, tempToken };
      }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const opaqueSecret = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = await bcrypt.hash(opaqueSecret, 10);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt,
        deviceLabel: parseUserAgent(data.userAgent),
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
      },
    });

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: session.id,
      purpose: 'access',
    });

    return {
      id: user.id,
      role: user.role,
      phone: user.phone,
      address: user.address,
      image: user.image,
      name: user.name,
      accessToken,
    };
  }

  private async notifyNewProviderLinked(email: string, provider: string) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
    await transporter.sendMail({
      from: `"HamroNepal Bazaar" <${process.env.MAIL_USER}>`,
      to: email,
      subject: 'New sign-in method added to your account',
      html: `<p>Your account was just signed into using <strong>${provider}</strong>, a method not previously used. If this wasn't you, please secure your account immediately.</p>`,
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        address: true,
        role: true,
        image: true,
        isActive: true,
        twoFactorEnabled: true,
        vendorProfile: true,
        doctorProfile: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, data: UpdateUserDto) {
    await this.findOne(id);
    const { name, address, image } = data;
    const updated = await this.prisma.user.update({
      where: { id },
      data: { name, address, image },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        image: true,
      },
    });
    await this.activityLogService.log(id, 'PROFILE_UPDATED');
    return updated;
  }

  async updateProfileImage(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    // Validate real content and re-encode to a safe JPEG before it is exposed.
    const finalName = await validateAndReencodeImage(
      file.path,
      './uploads/profile',
    );
    const imagePath = `/uploads/profile/${finalName}`;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { image: imagePath },
      select: { id: true, image: true },
    });

    // Delete the replaced image so old files do not accumulate publicly.
    if (previous?.image?.startsWith('/uploads/profile/')) {
      const oldName = previous.image.split('/').pop();
      if (oldName) {
        await fs.unlink(`./uploads/profile/${oldName}`).catch(() => {});
      }
    }

    await this.activityLogService.log(userId, 'PROFILE_PHOTO_CHANGED');
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);
    // Return a projection, not the raw row: the deleted record still carries
    // the bcrypt password hash and any live password-reset token.
    return this.prisma.user.delete({
      where: { id },
      select: { id: true, email: true, role: true, isActive: true },
    });
  }

  async updatePassword(
    id: string,
    dto: UpdatePasswordDto,
    currentSessionId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, password: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.password)
      throw new UnauthorizedException(
        'Password login is not enabled for this account',
      );

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid)
      throw new UnauthorizedException('Current password is incorrect');

    const newHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id },
      data: { password: newHash },
    });

    // Revoke every other session so a stolen token cannot survive a password change.
    await this.prisma.session.updateMany({
      where: {
        userId: id,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });

    await this.activityLogService.log(id, 'PASSWORD_CHANGED');
    return { message: 'Password updated successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password)
      return { message: 'If that email exists, a link has been sent.' };

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 1000 * 60 * 60);

    await this.prisma.user.update({
      where: { email },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });

    await transporter.sendMail({
      from: `"HamroNepal Bazaar" <${process.env.MAIL_USER}>`,
      to: email,
      subject: 'Password Reset Link',
      html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`,
    });

    return { message: 'If that email exists, a link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) throw new UnauthorizedException('Invalid or expired token');

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hash,
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password reset successfully' };
  }

  async requestPhoneUpdate(
    userId: string,
    phone: string,
    currentPassword?: string,
    otp?: string,
  ): Promise<{ message: string }> {
    await this.assertReauth(userId, currentPassword, otp);

    if (!/^(98|97)\d{8}$/.test(phone)) {
      throw new BadRequestException('Invalid Nepal phone number');
    }

    const taken = await this.prisma.user.findFirst({
      where: { phone, NOT: { id: userId } },
    });
    if (taken) throw new ConflictException('Phone number already in use');

    await this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerifiedAt: null },
    });

    await this.phoneOtpService.sendOtp(phone, OtpContext.USER_REGISTRATION);
    return { message: `OTP sent to ${phone}` };
  }

  async confirmPhoneUpdate(
    userId: string,
    otp: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    if (!user?.phone) {
      throw new BadRequestException(
        'No pending phone update. Request OTP first.',
      );
    }

    await this.phoneOtpService.verifyOtp(
      user.phone,
      otp,
      OtpContext.USER_REGISTRATION,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { phoneVerifiedAt: new Date() },
    });
    await this.activityLogService.log(userId, 'PHONE_CHANGED');
    return { message: 'Phone number verified and saved.' };
  }

  async requestEnableTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, phoneVerifiedAt: true, twoFactorEnabled: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFactorEnabled)
      throw new BadRequestException('Two-factor is already enabled.');
    if (!user.phone || !user.phoneVerifiedAt) {
      throw new BadRequestException(
        'Verify a phone number before enabling two-factor authentication.',
      );
    }
    await this.phoneOtpService.sendOtp(user.phone, OtpContext.TWO_FA_SETUP);
    return { message: `OTP sent to ${user.phone}` };
  }

  async confirmEnableTwoFactor(userId: string, otp: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user?.phone) throw new BadRequestException('No phone on file.');
    await this.phoneOtpService.verifyOtp(
      user.phone,
      otp,
      OtpContext.TWO_FA_SETUP,
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    await this.activityLogService.log(userId, 'TWO_FA_ENABLED');
    return { message: 'Two-factor authentication enabled.' };
  }

  async disableTwoFactor(
    userId: string,
    currentPassword?: string,
    otp?: string,
  ) {
    await this.assertReauth(userId, currentPassword, otp);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    });
    await this.activityLogService.log(userId, 'TWO_FA_DISABLED');
    return { message: 'Two-factor authentication disabled.' };
  }

  async removeSelf(userId: string, currentPassword?: string, otp?: string) {
    await this.assertReauth(userId, currentPassword, otp);
    // Revoke all live sessions before deleting the account.
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.prisma.user.delete({ where: { id: userId } });
  }

  /**
   * Step-up authentication for sensitive account actions (phone change, 2FA disable,
   * account deletion). Password accounts must confirm the current password; passwordless
   * (OAuth-only) accounts must confirm a fresh OTP sent to their verified phone.
   */
  private async assertReauth(
    userId: string,
    currentPassword?: string,
    otp?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, phone: true, phoneVerifiedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.password) {
      if (!currentPassword) {
        throw new ForbiddenException(
          'Please confirm your current password to continue.',
        );
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid)
        throw new ForbiddenException('Current password is incorrect.');
      return;
    }

    // Passwordless (OAuth-only) account: require a fresh OTP to the verified phone.
    if (!user.phone || !user.phoneVerifiedAt) {
      throw new ForbiddenException(
        'This account cannot perform this action without a verified phone number.',
      );
    }
    if (!otp) {
      await this.phoneOtpService.sendOtp(user.phone, OtpContext.REAUTH);
      throw new ForbiddenException(
        'An OTP was sent to your phone. Please confirm it to continue.',
      );
    }
    await this.phoneOtpService.verifyOtp(user.phone, otp, OtpContext.REAUTH);
  }
}
