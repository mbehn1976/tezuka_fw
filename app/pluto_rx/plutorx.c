/*
  ===========================================================================

  Copyright (C) 2024 Evariste F5OEO
 

  PLUTO_RX is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  PLUTO_RX is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License LIMfor more details.

  You should have received a copy of the GNU General Public License
  along with RX2TX.  If not, see <http://www.gnu.org/licenses/>.

  ===========================================================================
*/

// https://adaptivesupport.amd.com/s/article/75195?language=en_US


//
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <math.h>
#include <errno.h>

#include <getopt.h>
#include <ctype.h>
#include <termios.h>
#include <iio/iio.h>

#define PROGRAM_VERSION "0.0.1"

#include <sys/types.h>
#include <sys/socket.h>
#include <unistd.h>
#include <stdio.h>
#include <netinet/in.h> /* IPPROTO_IP, sockaddr_in, htons(), 
htonl() */
#include <arpa/inet.h>  /* inet_addr() */
#include <netdb.h>
#include <time.h>
#include <sys/ioctl.h>


// Global variable used by the signal handler and capture/encoding loop
static int want_quit = 0;
int m_sock;
struct sockaddr_in m_client;
char UdpOutput[255];

// Global signal handler for trapping SIGINT, SIGTERM, and SIGQUIT
static void signal_handler(int signal)
{
    want_quit = 1;
    //m_running = false;
}

void udp_set_ip(const char *ip)
{
    char text[40];
    char *add[2];
    u_int16_t sock;

    strcpy(text, ip);
    add[0] = strtok(text, ":");
    add[1] = strtok(NULL, ":");
    if (strlen(add[1]) == 0)
        sock = 1314;
    else
        sock = atoi(add[1]);
    // Construct the client sockaddr_in structure
    memset(&m_client, 0, sizeof(m_client));       // Clear struct
    m_client.sin_family = AF_INET;                // Internet/IP
    m_client.sin_addr.s_addr = inet_addr(add[0]); // IP address
    m_client.sin_port = htons(sock);              // server socket
}

void udp_send(char *b, size_t len)
{



    //#define UDP_MTU (1454)
    #define UDP_MTU 65507 
    int index = 0;
    for (index = 0; index < len; index += UDP_MTU)
    {

        sendto(m_sock, b+index, (index+UDP_MTU<len)?UDP_MTU:len-index , 0, (struct sockaddr *)&m_client, sizeof(m_client));
    }
    
}

void udp_init(void)
{
    // Create a socket for transmitting UDP TS packets
    if ((m_sock = socket(PF_INET, SOCK_DGRAM, IPPROTO_UDP)) < 0)
    {
        printf("Failed to create socket\n");
        return;
    }
    int one;

    //if (setsockopt(m_sock, SOL_SOCKET, SO_ZEROCOPY, &one, sizeof(one)))
    //    error(1, errno, "setsockopt zerocopy");

    udp_set_ip(UdpOutput);
}

void print_usage()
{

    fprintf(stderr,
            "plutorx -%s\n\
Usage:\nplutorx -n ip:port\n\
-h            help (print this help).\n\
-b Buffer Size \n\
-k Kernel number \n\
-p Measure Performance \n\
-o 16 or 8bits \n\
-s samplerate \n\
-u uri \n\
Example : ./plutorx -u ip:plutosdr.local -o 8\n\
\n",
            PROGRAM_VERSION);

} /* end function print_usage */

int main(int argc, char **argv)
{

    int a;
    int anyargs = 0;
    int upsample = 1;
    int buffer_size = 0;
    bool outnetwork = false;
    bool out_cs8=false;
    size_t buf_request=0;
    char type[255]="";
    long long SampleRate=0;
    unsigned int kernel_buffer_cnt=0;
    bool perf=false;
    while (1)
    {
        a = getopt(argc, argv, "hn:o:b:pu:k:s:");

        if (a == -1)
        {
            if (anyargs)
                break;
            else
                a = 'h'; //print usage and exit
        }
        anyargs = 1;

        switch (a)
        {

        case 'h': // help
            print_usage();
            exit(0);
            break;

        case 'n':
            strcpy(UdpOutput, optarg);
            outnetwork = true;
            break;
        case 'o':
            out_cs8 = (atoi(optarg)==8);
            break;
        case 'b':
            buf_request = atoi(optarg);
            break;
        case 'k':
            kernel_buffer_cnt = atoi(optarg);
            break;    
        case 'p':
            perf = true;
            break;
        case 'u':
            strcpy(type,optarg);
            break;
        case 's':
            SampleRate = atol(optarg);
            break;    
        
        case -1:
            break;
        case '?':
            if (isprint(optopt))
            {
                fprintf(stderr, "plutorx `-%c'.\n", optopt);
            }
            else
            {
                fprintf(stderr, "plutorx: unknown option character `\\x%x'.\n", optopt);
            }
            print_usage();

            exit(1);
            break;
        default:
            print_usage();
            exit(1);
            break;
        } /* end switch a */
    }     /* end while getopt() */

    
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    signal(SIGQUIT, signal_handler);
    signal(SIGPIPE, signal_handler);

    struct iio_context *ctx = NULL;
    //IIO Scan
    struct iio_scan *scan = iio_scan(NULL, "local,usb,ip");
    size_t found = iio_err(scan) ? 0 : iio_scan_get_results_count(scan);

    for(size_t contextidx=0;contextidx<found;contextidx++)
    {
        // Get dev info
        const char *dev_id = iio_scan_get_uri(scan, contextidx);
        fprintf(stderr,"Discovered : %s\n",dev_id);
        if(ctx==NULL && (strlen(type)==0 || strncmp(type,dev_id,strlen(type))==0))
        {
            ctx=iio_create_context(NULL, dev_id);
            if(iio_err(ctx))
                ctx=NULL;
            else
                fprintf(stderr,"Using %s \n",dev_id);
        }
    }

    if(!iio_err(scan))
        iio_scan_destroy(scan);
    if(ctx==NULL)
    {
        fprintf(stderr,"Error : No plutosdr found ! Exiting");
        exit(1);
    }
    // IIO Init
    struct iio_device *dev =  iio_context_find_device(ctx, "ad9361-phy");
    struct iio_device *rx = iio_context_find_device(ctx, "cf-ad9361-lpc");
    const struct iio_channel *chnI = iio_device_get_channel(rx, 0);
    const struct iio_channel *chnQ = iio_device_get_channel(rx, 1);
    struct iio_channels_mask *mask = iio_create_channels_mask(iio_device_get_channels_count(rx));
    struct iio_buffer *rxbuf = iio_device_get_buffer(rx, 0);
    const struct iio_attr *rate_attr = iio_channel_find_attr(iio_device_find_channel(dev,"voltage0",false),"sampling_frequency");
    if(!mask || !rxbuf || !rate_attr)
    {
        fprintf(stderr,"Error : cannot set up the RX buffer\n");
        exit(1);
    }
    iio_channel_enable(chnI, mask);
    if(!out_cs8)
         iio_channel_enable(chnQ, mask);

    size_t blockSize=1024;

    if(SampleRate>0)
    {

        iio_attr_write_longlong(rate_attr,SampleRate);
    }
    
    //#define SAMPLE_MINI 25000000/12
    #define SAMPLE_MINI 18000000
    #define SAMPLE_MAX 64000000
    //#define MAX_BUFF_SIZE 8000000LL/2LL
    #define MAX_BUFF_SIZE 32000000LL
    #define MAX_TOTAL_SIZE 60000000LL
    #define MAX_CNT 64
   
    iio_attr_read_longlong(rate_attr,&SampleRate);
   
    // Get a 100 ms buffer    
   
    if(buf_request>0)
        blockSize=buf_request;
    else
    blockSize = SampleRate/8LL; 
    blockSize=(blockSize>>12)<<12;
    if(blockSize>MAX_BUFF_SIZE) blockSize=MAX_BUFF_SIZE;
    if(kernel_buffer_cnt==0)
    {
        kernel_buffer_cnt=MAX_TOTAL_SIZE/(blockSize);
        if(kernel_buffer_cnt>MAX_CNT) kernel_buffer_cnt=MAX_CNT;
    }    


    // one stream of kernel_buffer_cnt blocks (0.x: kernel buffers count + buffer)
    struct iio_stream *stream = iio_buffer_create_stream(rxbuf, kernel_buffer_cnt, blockSize/4, mask); //2 because driver think it is 16bit
    if(iio_err(stream))
    {
        fprintf(stderr,"Error : cannot create the RX stream (%d)\n",iio_err(stream));
        exit(1);
    }
    fprintf(stderr,"Using %d buffers of %ld bytes\n",kernel_buffer_cnt,blockSize);
    if (outnetwork)
    {
        udp_init();
        udp_set_ip(UdpOutput);
    }
    
   
    fprintf(stderr, "Start receiving\n");
    uint32_t val;
    char *RxBuffer = NULL;
    iio_device_reg_read(rx, 0x80000088, &val);
    iio_device_reg_write(rx, 0x80000088, val);
    size_t BlockRead=0;
    size_t ErrorRead=0;

    if(!perf)
    {
        
        if(SampleRate)
        while (want_quit == 0)
        {
            const struct iio_block *blk = iio_stream_get_next_block(stream);
            if (iio_err(blk))
            {
                fprintf(stderr,"Error : cannot read a block (%d)\n",iio_err(blk));
                break;
            }
            char *first = (char*)iio_block_first(blk, chnI);
            size_t Size = (char*)iio_block_end(blk) - first;
            
            iio_device_reg_read(rx, 0x80000088, &val);
            if (val & 4)
            {
                //fprintf(stderr,"PlutoSDR underflow!\n");
                fprintf(stderr,"!");fflush(stderr);
                iio_device_reg_write(rx, 0x80000088, val);
            }
            
            if (outnetwork)
            {

                //fprintf(stderr, "-> %04x %04x %04x  \n", RxBuffer[0] & 0xFFFF, RxBuffer[1] & 0xFFFF, RxBuffer[2] & 0xFFFF);
                //fprintf(stderr, "Rx %ld  \n",Size);
                udp_send(first, Size );
            }
            else
            {
               
                     fwrite(first,1, Size, stdout);
            }
    
        }
    }
    else
    {
         size_t ErrorRead=0;
         size_t step=250000;
        
        for(SampleRate=out_cs8?SAMPLE_MINI*2:SAMPLE_MINI;(SampleRate<SAMPLE_MAX)&&(ErrorRead==0);SampleRate+=step)
        {
            iio_attr_write_longlong(rate_attr,SampleRate);
            if(stream!=NULL) iio_stream_destroy(stream);
            blockSize = SampleRate/8LL; 
            blockSize=(blockSize>>2)<<2;
            if(blockSize>MAX_BUFF_SIZE) blockSize=MAX_BUFF_SIZE;
            kernel_buffer_cnt=MAX_TOTAL_SIZE/(blockSize);
            if(kernel_buffer_cnt>MAX_CNT) kernel_buffer_cnt=MAX_CNT;
            stream = iio_buffer_create_stream(rxbuf, kernel_buffer_cnt, blockSize/4, mask); //same unit as the first stream: blockSize is in bytes
            if(iio_err(stream))
            {
                fprintf(stderr,"Error : cannot create the RX stream (%d)\n",iio_err(stream));
                stream = NULL;
                break;
            }
            fprintf(stderr,"Using %d buffers of %ld bytes\n",kernel_buffer_cnt,blockSize);

           fprintf(stderr,"Trying sampleRate %lld\n",SampleRate);
            iio_device_reg_read(rx, 0x80000088, &val);
            iio_device_reg_write(rx, 0x80000088, val);
            int ReadLength= SampleRate*8/blockSize;
            fprintf(stderr,"Start running %d block!\n",ReadLength);

            for(size_t Read=0;(Read<ReadLength)&&(ErrorRead==0);Read++)
            {
                if (want_quit == 1) return 0;
                const struct iio_block *blk = iio_stream_get_next_block(stream);
                if (iio_err(blk))
                {
                    ErrorRead++;
                    break;
                }
                
                iio_device_reg_read(rx, 0x80000088, &val);
                if (val & 4)
                {
                    //fprintf(stderr,"PlutoSDR underflow!\n");
                    ErrorRead++;
                    
                    iio_device_reg_write(rx, 0x80000088, val);
                    break;
                }
                
            }
            if(ErrorRead)
            {
                 fprintf(stderr,"Underrun detected: exting...\n");
                  break;
            }
        }
        fprintf(stderr,"Sample Max=%lld\n",SampleRate-step);
    }
    return 0;
}
